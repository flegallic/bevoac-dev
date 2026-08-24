#!/usr/bin/env python3
"""Compatibility entrypoint. The active release validator is V6.2.0."""
from pathlib import Path
import os
import sys

TARGET = Path(__file__).with_name('validate_v6_2_0.py')
os.execv(sys.executable, [sys.executable, str(TARGET), *sys.argv[1:]])
