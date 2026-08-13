"""Durable storage adapters."""

from .supabase_client import SupabaseWriter, get_writer

__all__ = ["SupabaseWriter", "get_writer"]
