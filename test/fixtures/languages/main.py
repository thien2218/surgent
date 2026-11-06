from __future__ import annotations

import os.path as osp
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

try:
    import ujson as json
except ImportError:
    import json

if TYPE_CHECKING:
    from collections.abc import Iterator

__all__ = ["Point", "load"]

VERSION = "1.0"
low, high = 0, 10
square = lambda value: value * value

type Vector = list[float]


def load(path):
    def parse():
        pass

    result = parse()
    return result


@cache
async def fetch(url):
    pass


@dataclass
class Point:
    x: int
    y: int = 0
    tags: list[str] = field(default_factory=list)
    scale = lambda self, factor: factor

    def __init__(self):
        self.z = 0

    @staticmethod
    def origin():
        return Point()

    class Meta:
        ordering = ["x"]
