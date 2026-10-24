"""Equipment profiles: the kinds of equipment a Rasher device can be. Each is a Profile (device.py) by its type."""

from .fcu import FCU
from .meter import Meter
from .vav import VAV

PROFILES = {p.type: p for p in (FCU, Meter, VAV)}
