use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{
    env, near_bindgen, require, AccountId, NearToken, PanicOnDefault, Promise,
};

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
    allowlist_enabled: bool,
    paused: bool,
    agent_spent: LookupMap<AccountId, u128>,
}

#[near_bindgen]
impl PolicyVault {
    #[init]
    pub fn new(owner: AccountId, max_per_tx: U128, max_daily: U128) -> Self {
        Self {
            owner,
            max_per_tx: max_per_tx.0,
            max_daily: max_daily.0,
            daily_spent: 0,
            day_bucket: Self::current_day(),
            allowlist: UnorderedSet::new(b"a"),
            blocklist: UnorderedSet::new(b"b"),
            allowlist_enabled: false,
            paused: false,
            agent_spent: LookupMap::new(b"s"),
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
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }

    #[payable]
    pub fn deposit(&mut self) {
        require!(env::attached_deposit().as_yoctonear() > 0, "Attach NEAR");
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

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    /// Agent spend path. Give the agent a function-call access key scoped ONLY
    /// to this method. The protocol then refuses Transfer / AddKey / DeleteKey
    /// for that key — even if the agent is prompt-injected.
    pub fn spend(&mut self, receiver_id: AccountId, amount: U128) -> Promise {
        require!(!self.paused, "Vault paused");
        let amount = amount.0;
        require!(amount > 0, "Amount must be > 0");
        require!(amount <= self.max_per_tx, "Exceeds max_per_tx");
        require!(!self.blocklist.contains(&receiver_id), "Receiver blocked");
        if self.allowlist_enabled {
            require!(self.allowlist.contains(&receiver_id), "Receiver not on allowlist");
        }
        self.refresh_day();
        require!(
            self.daily_spent.saturating_add(amount) <= self.max_daily,
            "Exceeds max_daily"
        );
        let bal = env::account_balance().as_yoctonear();
        let reserved: u128 = 50_000_000_000_000_000_000_000; // 0.05 NEAR
        require!(bal >= amount + reserved, "Insufficient vault balance");

        self.daily_spent = self.daily_spent.saturating_add(amount);
        let agent = env::predecessor_account_id();
        let prev = self.agent_spent.get(&agent).unwrap_or(0);
        self.agent_spent.insert(&agent, &(prev.saturating_add(amount)));

        env::log_str(&format!(
            "SPEND ok agent={} receiver={} amount={} daily_spent={}",
            agent, receiver_id, amount, self.daily_spent
        ));
        Promise::new(receiver_id).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        let amount = amount.0;
        require!(env::account_balance().as_yoctonear() >= amount, "Insufficient");
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn get_policy(&self) -> PolicyView {
        PolicyView {
            owner: self.owner.clone(),
            max_per_tx: U128(self.max_per_tx),
            max_daily: U128(self.max_daily),
            daily_spent: U128(self.daily_spent),
            allowlist_enabled: self.allowlist_enabled,
            paused: self.paused,
            balance: U128(env::account_balance().as_yoctonear()),
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
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PolicyView {
    pub owner: AccountId,
    pub max_per_tx: U128,
    pub max_daily: U128,
    pub daily_spent: U128,
    pub allowlist_enabled: bool,
    pub paused: bool,
    pub balance: U128,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, AccountId};

    fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor);
        b.attached_deposit(NearToken::from_yoctonear(deposit));
        b.account_balance(NearToken::from_near(10));
        b
    }

    #[test]
    fn blocks_over_max_per_tx() {
        let owner = accounts(0);
        testing_env!(ctx(owner.clone(), 0).build());
        let mut c = PolicyVault::new(owner.clone(), U128(1_000_000_000_000_000_000_000_000), U128(5_000_000_000_000_000_000_000_000)); // 1 / 5 NEAR
        testing_env!(ctx(accounts(1), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(2), U128(2_000_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }

    #[test]
    fn blocks_blocklisted_receiver() {
        let owner = accounts(0);
        testing_env!(ctx(owner.clone(), 0).build());
        let mut c = PolicyVault::new(owner.clone(), U128(5_000_000_000_000_000_000_000_000), U128(10_000_000_000_000_000_000_000_000));
        c.blocklist_add(accounts(5));
        testing_env!(ctx(accounts(1), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(5), U128(1_000_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }

    #[test]
    fn allowlist_enforced() {
        let owner = accounts(0);
        testing_env!(ctx(owner.clone(), 0).build());
        let mut c = PolicyVault::new(owner.clone(), U128(5_000_000_000_000_000_000_000_000), U128(10_000_000_000_000_000_000_000_000));
        c.set_allowlist_enabled(true);
        c.allowlist_add(accounts(3));
        testing_env!(ctx(accounts(1), 0).build());
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.spend(accounts(2), U128(1_000_000_000_000_000_000_000_000));
        }));
        assert!(err.is_err());
    }
}
