"""Derived transaction identity attributes.

The ULB credit card dataset is fully anonymised: it contains 28 PCA components,
an elapsed-seconds timestamp, an amount and a fraud label. It has no account id,
merchant or location, yet the PRD requires account level risk aggregation
(FR-011) and merchant/location context on the dashboard.

This module derives those attributes deterministically from the PCA signature of
each row, so the same transaction always maps to the same account, merchant and
city across runs and machines. Because rows with similar PCA signatures map to
the same account, repeated suspicious behaviour concentrates on a handful of
accounts, which is exactly the behaviour the account risk engine needs to show.

Two rules apply and are enforced by tests:

1. These attributes are NEVER used as model inputs (see ``config.MODEL_FEATURES``).
   They exist for aggregation and presentation only, so they cannot leak signal
   into the classifier.
2. The mapping is a hash, not a lookup of real cardholder data. Nothing here is
   personal data.
"""

from __future__ import annotations

from hashlib import blake2b
from typing import Dict, Mapping, Tuple

ACCOUNT_POOL_SIZE = 420

MERCHANT_CATEGORIES: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("Grocery", ("FreshMart", "GreenBasket", "DailyGrocer", "Cornerstore Foods")),
    ("Electronics", ("VoltZone", "PixelHub", "Circuit Depot", "NovaTech Store")),
    ("Travel", ("SkyRoute Air", "Northline Rail", "Harbour Stays", "TransitGo")),
    ("Digital Goods", ("StreamNest", "AppVault", "GameForge", "CloudLocker")),
    ("Fuel", ("PetroPoint", "HighwayFuel", "CityGas")),
    ("Apparel", ("Loom & Co", "UrbanThread", "NorthKit Outfitters")),
    ("Restaurant", ("Olive Table", "Ramen Yard", "The Copper Pot", "Cafe Meridian")),
    ("Money Transfer", ("QuickRemit", "PayBridge", "SendLine")),
    ("Gaming", ("BetLine", "SpinDeck", "ArenaPlay")),
    ("Crypto Exchange", ("CoinGate X", "BlockDesk", "LedgerPeak")),
)

LOCATIONS: Tuple[Tuple[str, str], ...] = (
    ("Mumbai", "IN"),
    ("Bengaluru", "IN"),
    ("Delhi", "IN"),
    ("Chennai", "IN"),
    ("London", "GB"),
    ("Manchester", "GB"),
    ("Berlin", "DE"),
    ("Amsterdam", "NL"),
    ("Paris", "FR"),
    ("Madrid", "ES"),
    ("Warsaw", "PL"),
    ("Dubai", "AE"),
    ("Singapore", "SG"),
    ("Sydney", "AU"),
    ("Toronto", "CA"),
    ("New York", "US"),
    ("Chicago", "US"),
    ("Austin", "US"),
    ("Sao Paulo", "BR"),
    ("Lagos", "NG"),
)

CHANNELS: Tuple[str, ...] = ("ecommerce", "card_present", "recurring", "mobile_wallet")


def _digest(*parts: object) -> int:
    """Stable 64-bit digest of the given parts (order sensitive)."""
    hasher = blake2b(digest_size=8)
    for part in parts:
        hasher.update(str(part).encode("utf-8"))
        hasher.update(b"|")
    return int.from_bytes(hasher.digest(), "big")


def _quantise(value: object, places: int = 1) -> float:
    try:
        return round(float(value), places)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def derive_identity(record: Mapping[str, object]) -> Dict[str, object]:
    """Derive account, card, merchant, category, location and channel for a row.

    Deterministic: identical input values always produce identical output.
    """
    account_seed = _digest(
        "account",
        _quantise(record.get("V1"), 0),
        _quantise(record.get("V2"), 0),
        _quantise(record.get("V3"), 0),
    )
    merchant_seed = _digest("merchant", _quantise(record.get("V4")), _quantise(record.get("V5")))
    location_seed = _digest("location", _quantise(record.get("V6")), _quantise(record.get("V7")))
    channel_seed = _digest("channel", _quantise(record.get("V8")), _quantise(record.get("V9")))

    account_index = account_seed % ACCOUNT_POOL_SIZE
    account_id = f"ACC-{account_index:05d}"
    card_last4 = f"{(account_seed >> 17) % 10_000:04d}"

    category, merchants = MERCHANT_CATEGORIES[merchant_seed % len(MERCHANT_CATEGORIES)]
    merchant = merchants[(merchant_seed >> 11) % len(merchants)]

    city, country = LOCATIONS[location_seed % len(LOCATIONS)]
    channel = CHANNELS[channel_seed % len(CHANNELS)]

    return {
        "account_id": account_id,
        "card_last4": card_last4,
        "merchant": merchant,
        "merchant_category": category,
        "location": f"{city}, {country}",
        "city": city,
        "country": country,
        "channel": channel,
    }
