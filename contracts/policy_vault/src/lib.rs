use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::UnorderedSet;
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{
    env, near_bindgen, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

/// Gas for the private settlement callback after a native transfer.
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(10);
/// Keep enough NEAR for storage + a few more txs after spends/withdrawals.
const OPERATING_RESERVE: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh(crate = "near_sdk::borsh")]
pub struct PolicyVault {
    owner: AccountId,
    max_per_tx: u128,
    max_daily: u128,
    daily_spent: u128,
    day_bucket: u64,
    allowlist: UnorderedSet<AccountId>,
    blocklist: UnorderedSet<AccountId>,
    /// Accounts allowed to call `spend` (typically the vault itself with an FC key,
    /// or a dedicated agent sub-account). Without this set, anyone could drain funds.
    authorized_agents: UnorderedSet<AccountId>,
    allowlist_enabled: bool,
    paused: bool,
    /// Lifetime successful spends per authorized agent (settled only).
    agent_spent: UnorderedSet<AccountId>, // kept for schema stability; see agent_totals below
    /// Reserved (in-flight) amount for the current day — counted against daily cap.
    daily_reserved: u128,
}

#[near_bindgen]
impl PolicyVault {
    /// Initialize. Only the contract account itself may call this (atomic deploy+init
    /// or first tx signed by the account's full-access key).
    #[init(ignore_state)]
    pub fn new(owner: AccountId, max_per_tx: U128, max_daily: U128) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Init only by contract account"
        );
        Self {
            owner,
            max_per_tx: max_per_tx.0,
            max_daily: max_daily.0,
            daily_spent: 0,
            day_bucket: Self::current_day(),
            allowlist: UnorderedSet::new(b"a"),
            blocklist: UnorderedSet::new(b"b"),
            authorized_agents: UnorderedSet::new(b"g"),
            allowlist_enabled: false,
            paused: false,
            agent_spent: UnorderedSet::new(b"s"),
            daily_reserved: 0,
        }
    }

    fn current_day() -> u64 {
        env::block_timestamp() / 86_400_000_000_000
    }

    fn refresh_day(&mut self) {
        let d = Self::current_day();
        if d != self.day_bucket {
            self.day_bucket = d;
            self.daily_spent = 0;
            self.daily_reserved = 0;
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }

    fn assert_agent(&self) {
        let pred = env::predecessor_account_id();
        require!(
            self.authorized_agents.contains(&pred),
            "Unauthorized agent"
        );
    }

    fn usable_balance(&self) -> u128 {
        let bal = env::account_balance().as_yoctonear();
        bal.saturating_sub(OPERATING_RESERVE)
    }

    #[payable]
    pub fn deposit(&mut self) {
        require!(env::attached_deposit().as_yoctonear() > 0, "Attach NEAR");
        env::log_str(&format!(
            "DEPOSIT amount={}",
            env::attached_deposit().as_yoctonear()
        ));
    }

    pub fn set_limits(&mut self, max_per_tx: U128, max_daily: U128) {
        self.assert_owner();
        self.max_per_tx = max_per_tx.0;
        self.max_daily = max_daily.0;
    }

    pub fn set_allowlist_enabled(&mut self, enabled: bool) {
        self.assert_owner();
        self.allowlist_enabled = enabled;
    }

    pub fn allowlist_add(&mut self, account: AccountId) {
        self.assert_owner();
        self.allowlist.insert(&account);
    }

    pub fn allowlist_remove(&mut self, account: AccountId) {
        self.assert_owner();
        self.allowlist.remove(&account);
    }

    pub fn blocklist_add(&mut self, account: AccountId) {
        self.assert_owner();
        self.blocklist.insert(&account);
    }

    pub fn blocklist_remove(&mut self, account: AccountId) {
        self.assert_owner();
        self.blocklist.remove(&account);
    }

    pub fn agent_add(&mut self, account: AccountId) {
        self.assert_owner();
        self.authorized_agents.insert(&account);
    }

    pub fn agent_remove(&mut self, account: AccountId) {
        self.assert_owner();
        self.authorized_agents.remove(&account);
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    /// Agent spend path. Caller MUST be in `authorized_agents`. Give the agent a
    /// function-call access key scoped ONLY to this method. The protocol then refuses
    /// Transfer / AddKey / DeleteKey for that key — even if the agent is prompt-injected.
    pub fn spend(&mut self, receiver_id: AccountId, amount: U128) -> Promise {
        self.assert_agent();
        require!(!self.paused, "Vault paused");
        let amount = amount.0;
        require!(amount > 0, "Amount must be > 0");
        require!(amount <= self.max_per_tx, "Exceeds max_per_tx");
        require!(!self.blocklist.contains(&receiver_id), "Receiver blocked");
        if self.allowlist_enabled {
            require!(
                self.allowlist.contains(&receiver_id),
                "Receiver not on allowlist"
            );
        }
        self.refresh_day();
        let used = self
            .daily_spent
            .saturating_add(self.daily_reserved)
            .saturating_add(amount);
        require!(used <= self.max_daily, "Exceeds max_daily");
        require!(self.usable_balance() >= amount, "Insufficient vault balance");

        // Reserve against the daily cap until the transfer settles.
        self.daily_reserved = self.daily_reserved.saturating_add(amount);
        let day = self.day_bucket;
        let agent = env::predecessor_account_id();

        env::log_str(&format!(
            "SPEND scheduled agent={} receiver={} amount={} day={}",
            agent, receiver_id, amount, day
        ));

        Promise::new(receiver_id)
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_transfer_complete(amount, day, agent),
            )
    }

    /// Private callback: commit or release the daily reservation.
    #[private]
    pub fn on_transfer_complete(
        &mut self,
        amount: u128,
        day: u64,
        agent: AccountId,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        // Always release the reservation for the day it was taken, if still current.
        if self.day_bucket == day {
            self.daily_reserved = self.daily_reserved.saturating_sub(amount);
        }

        if result.is_ok() {
            if self.day_bucket == day {
                self.daily_spent = self.daily_spent.saturating_add(amount);
            }
            // Track that this agent has at least one successful spend (set membership).
            self.agent_spent.insert(&agent);
            env::log_str(&format!(
                "SPEND settled ok agent={} amount={} daily_spent={}",
                agent, amount, self.daily_spent
            ));
        } else {
            env::log_str(&format!(
                "SPEND failed — budget released agent={} amount={}",
                agent, amount
            ));
        }
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        let amount = amount.0;
        require!(self.usable_balance() >= amount, "Insufficient");
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn get_policy(&self) -> PolicyView {
        let (daily_spent, daily_reserved, day_bucket) = self.effective_daily();
        PolicyView {
            owner: self.owner.clone(),
            max_per_tx: U128(self.max_per_tx),
            max_daily: U128(self.max_daily),
            daily_spent: U128(daily_spent),
            daily_reserved: U128(daily_reserved),
            day_bucket,
            allowlist_enabled: self.allowlist_enabled,
            paused: self.paused,
            balance: U128(env::account_balance().as_yoctonear()),
            authorized_agents: self.authorized_agents.len(),
        }
    }

    fn effective_daily(&self) -> (u128, u128, u64) {
        let d = Self::current_day();
        if d != self.day_bucket {
            (0, 0, d)
        } else {
            (self.daily_spent, self.daily_reserved, self.day_bucket)
        }
    }

    pub fn is_blocked(&self, account: AccountId) -> bool {
        self.blocklist.contains(&account)
    }

    pub fn is_allowed(&self, account: AccountId) -> bool {
        if self.blocklist.contains(&account) {
            return false;
        }
        if self.allowlist_enabled {
            return self.allowlist.contains(&account);
        }
        true
    }

    pub fn is_authorized_agent(&self, account: AccountId) -> bool {
        self.authorized_agents.contains(&account)
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PolicyView {
    pub owner: AccountId,
    pub max_per_tx: U128,
    pub max_daily: U128,
    pub daily_spent: U128,
    pub daily_reserved: U128,
    pub day_bucket: u64,
    pub allowlist_enabled: bool,
    pub paused: bool,
    pub balance: U128,
    pub authorized_agents: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, AccountId};

    fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0));
        b.predecessor_account_id(predecessor);
        b.attached_deposit(NearToken::from_yoctonear(deposit));
        b.account_balance(NearToken::from_near(10));
        b
    }

    fn fresh() -> PolicyVault {
        // init must be called by the contract account itself
        testing_env!(ctx(accounts(0), 0).build());
        let mut c = PolicyVault::new(
            accounts(0),
            U128(1_000_000_000_000_000_000_000_000), // 1 NEAR
            U128(5_000_000_000_000_000_000_000_000), // 5 NEAR
        );
        c.agent_add(accounts(1));
        c
    }

    #[test]
    fn blocks_over_max_per_tx() {
        let mut c = fresh();
        testing_env!(ctx(accounts(1), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(2), U128(2_000_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }

    #[test]
    fn blocks_blocklisted_receiver() {
        let mut c = fresh();
        testing_env!(ctx(accounts(0), 0).build());
        c.blocklist_add(accounts(5));
        testing_env!(ctx(accounts(1), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(5), U128(500_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }

    #[test]
    fn allowlist_enforced() {
        let mut c = fresh();
        testing_env!(ctx(accounts(0), 0).build());
        c.set_allowlist_enabled(true);
        c.allowlist_add(accounts(3));
        testing_env!(ctx(accounts(1), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(2), U128(500_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }

    #[test]
    fn unauthorized_agent_rejected() {
        let mut c = fresh();
        // accounts(2) was never agent_add'ed
        testing_env!(ctx(accounts(2), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(3), U128(100_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }

    #[test]
    fn init_rejects_outsider() {
        testing_env!(ctx(accounts(1), 0).build()); // predecessor != current
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            PolicyVault::new(
                accounts(1),
                U128(1_000_000_000_000_000_000_000_000),
                U128(5_000_000_000_000_000_000_000_000),
            );
        }));
        assert!(err.is_err());
    }

    #[test]
    fn pause_blocks_spend() {
        let mut c = fresh();
        testing_env!(ctx(accounts(0), 0).build());
        c.pause();
        testing_env!(ctx(accounts(1), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(3), U128(100_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }
}
