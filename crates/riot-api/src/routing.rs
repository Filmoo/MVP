//! Riot routes requests either to a platform (`euw1.api.riotgames.com`) or to a regional
//! cluster (`europe.api.riotgames.com`). Rate limits apply per routing value.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    Br1,
    Eun1,
    Euw1,
    Jp1,
    Kr,
    La1,
    La2,
    Me1,
    Na1,
    Oc1,
    Ru,
    Sg2,
    Tr1,
    Tw2,
    Vn2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Region {
    Americas,
    Asia,
    Europe,
    Sea,
}

impl Platform {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Br1 => "br1",
            Self::Eun1 => "eun1",
            Self::Euw1 => "euw1",
            Self::Jp1 => "jp1",
            Self::Kr => "kr",
            Self::La1 => "la1",
            Self::La2 => "la2",
            Self::Me1 => "me1",
            Self::Na1 => "na1",
            Self::Oc1 => "oc1",
            Self::Ru => "ru",
            Self::Sg2 => "sg2",
            Self::Tr1 => "tr1",
            Self::Tw2 => "tw2",
            Self::Vn2 => "vn2",
        }
    }

    /// Cluster serving Match-V5 for this platform.
    pub const fn region(self) -> Region {
        match self {
            Self::Na1 | Self::Br1 | Self::La1 | Self::La2 => Region::Americas,
            Self::Kr | Self::Jp1 => Region::Asia,
            Self::Euw1 | Self::Eun1 | Self::Tr1 | Self::Ru | Self::Me1 => Region::Europe,
            Self::Oc1 | Self::Sg2 | Self::Tw2 | Self::Vn2 => Region::Sea,
        }
    }

    /// Account-V1 is served by americas/asia/europe only (any returns the same data).
    pub const fn account_region(self) -> Region {
        match self.region() {
            Region::Sea => Region::Asia,
            other => other,
        }
    }
}

impl Region {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Americas => "americas",
            Self::Asia => "asia",
            Self::Europe => "europe",
            Self::Sea => "sea",
        }
    }
}

/// Where a request goes; also the key of its rate limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Route {
    Platform(Platform),
    Region(Region),
}

impl Route {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Platform(p) => p.id(),
            Self::Region(r) => r.id(),
        }
    }
}

impl fmt::Display for Route {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.id())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_platforms_to_match_regions() {
        assert_eq!(Platform::Euw1.region(), Region::Europe);
        assert_eq!(Platform::Me1.region(), Region::Europe);
        assert_eq!(Platform::Kr.region(), Region::Asia);
        assert_eq!(Platform::Vn2.region(), Region::Sea);
        assert_eq!(Platform::Vn2.account_region(), Region::Asia);
        assert_eq!(Route::Platform(Platform::Euw1).id(), "euw1");
    }
}
