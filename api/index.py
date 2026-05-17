"""
Vercel serverless entry point.
Vercel's Python runtime detects the `app` variable and wraps it as an ASGI handler.
"""
import sys
import os

# Ensure the project root is on sys.path so `app` package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: F401 — Vercel picks this up automatically
