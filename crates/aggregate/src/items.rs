//! Which purchases count as completed items: built from Data Dragon's `item.json` of the patch.

use std::collections::BTreeSet;

use serde_json::Value;

/// Base boots (not a build choice).
const BASE_BOOTS: u32 = 1001;
/// Cheapest completed legendary (tier-2 items and components cost less).
const LEGENDARY_MIN_GOLD: u64 = 2_000;

/// Completed legendary items and upgraded boots of one patch.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ItemCatalog {
    legendary: BTreeSet<u32>,
    boots: BTreeSet<u32>,
}

impl ItemCatalog {
    pub fn new(
        legendary: impl IntoIterator<Item = u32>,
        boots: impl IntoIterator<Item = u32>,
    ) -> Self {
        Self {
            legendary: legendary.into_iter().collect(),
            boots: boots.into_iter().collect(),
        }
    }

    /// Classifies Data Dragon's `item.json`: boots = the `Boots` tag minus base boots;
    /// legendary = a final item (it builds into nothing, or only into Ornn upgrades) sold in
    /// the shop for at least 2,000 gold, not a consumable, trinket or champion-only item.
    pub fn from_data_dragon(item_json: &Value) -> Self {
        let mut catalog = Self::default();
        let Some(data) = item_json.get("data").and_then(Value::as_object) else {
            return catalog;
        };
        let has_tag = |item: &Value, tag: &str| {
            item.get("tags")
                .and_then(Value::as_array)
                .is_some_and(|tags| tags.iter().any(|t| t.as_str() == Some(tag)))
        };
        let ornn_upgrade = |id: &str| {
            data.get(id)
                .is_some_and(|i| i.get("requiredAlly").is_some())
        };
        for (id, item) in data {
            let Ok(id_num) = id.parse::<u32>() else {
                continue;
            };
            if has_tag(item, "Boots") {
                if id_num != BASE_BOOTS {
                    catalog.boots.insert(id_num);
                }
                continue;
            }
            let gold = item.get("gold");
            let purchasable = gold
                .and_then(|g| g.get("purchasable"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let total = gold
                .and_then(|g| g.get("total"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let final_item = item
                .get("into")
                .and_then(Value::as_array)
                .is_none_or(|into| into.iter().filter_map(Value::as_str).all(ornn_upgrade));
            let in_store = item.get("inStore").and_then(Value::as_bool).unwrap_or(true);
            if purchasable
                && in_store
                && final_item
                && total >= LEGENDARY_MIN_GOLD
                && item.get("requiredChampion").is_none()
                && item.get("requiredAlly").is_none()
                && !has_tag(item, "Consumable")
                && !has_tag(item, "Trinket")
            {
                catalog.legendary.insert(id_num);
            }
        }
        catalog
    }

    pub fn is_legendary(&self, item: u32) -> bool {
        self.legendary.contains(&item)
    }

    pub fn is_boots(&self, item: u32) -> bool {
        self.boots.contains(&item)
    }

    pub fn is_empty(&self) -> bool {
        self.legendary.is_empty() && self.boots.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn classifies_data_dragon_items() {
        let items = json!({ "data": {
            "1001": { "tags": ["Boots"], "gold": { "total": 300, "purchasable": true }, "into": ["3006"] },
            "3006": { "tags": ["Boots", "AttackSpeed"], "gold": { "total": 1100, "purchasable": true }, "from": ["1001"] },
            "3031": { "tags": ["Damage"], "gold": { "total": 3450, "purchasable": true } },
            "6653": { "gold": { "total": 3000, "purchasable": true }, "into": ["7010"] },
            "7010": { "gold": { "total": 3000, "purchasable": false }, "requiredAlly": "Ornn" },
            "1037": { "gold": { "total": 875, "purchasable": true }, "into": ["3031"] },
            "3133": { "gold": { "total": 1100, "purchasable": true }, "into": ["3071"] },
            "2003": { "tags": ["Consumable"], "gold": { "total": 50, "purchasable": true } },
            "3600": { "gold": { "total": 2500, "purchasable": true }, "requiredChampion": "Kalista" },
            "3340": { "tags": ["Trinket"], "gold": { "total": 0, "purchasable": true } },
            "bad": { "gold": { "total": 9999, "purchasable": true } }
        }});
        let c = ItemCatalog::from_data_dragon(&items);
        assert!(c.is_boots(3006) && !c.is_boots(1001));
        assert!(c.is_legendary(3031), "final expensive item");
        assert!(c.is_legendary(6653), "builds only into an Ornn upgrade");
        for id in [7010, 1037, 3133, 2003, 3600, 3340, 3006] {
            assert!(!c.is_legendary(id), "{id}");
        }
        assert!(ItemCatalog::from_data_dragon(&json!({})).is_empty());
    }
}
