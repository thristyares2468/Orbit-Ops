#!/usr/bin/env python3
# Last updated: 13 August 2026
"""Copy the supplied Ben's Outdoor Care artwork without recolouring or filtering."""

from pathlib import Path
from shutil import copyfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/Users/ltaylor2/Desktop/Stuff/Bens Files/Bens Outdoor Care images')


def copy_original(source_name, output_name):
    destination = ROOT / output_name
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(SOURCE / source_name, destination)


copy_original('ChatGPT Image Aug 13, 2026, 12_40_43 PM (10).png', 'bens-outdoor-care-logo-v3.png')
copy_original('ChatGPT Image Aug 13, 2026, 12_40_43 PM (9).png', 'bens-outdoor-care-mark-v3.png')
copy_original('ChatGPT Image Aug 13, 2026, 12_40_41 PM (3).png', 'assets/profile-icons/player-round-v3.png')
copy_original('ChatGPT Image Aug 13, 2026, 12_40_42 PM (8).png', 'assets/profile-icons/player-shield-v3.png')
copy_original('ChatGPT Image Aug 13, 2026, 12_40_43 PM (9).png', 'assets/profile-icons/player-portrait-v3.png')
copy_original('ChatGPT Image Aug 13, 2026, 12_40_42 PM (7).png', 'assets/profile-icons/admin-v3.png')
