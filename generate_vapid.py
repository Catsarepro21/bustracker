"""Run this script once to generate your VAPID keys. Copy the output into your .env file."""
from py_vapid import Vapid
import base64
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, PrivateFormat, NoEncryption

v = Vapid()
v.generate_keys()

pub = base64.urlsafe_b64encode(
    v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
).decode().rstrip('=')

priv = base64.urlsafe_b64encode(
    v.private_key.private_bytes(Encoding.DER, PrivateFormat.TraditionalOpenSSL, NoEncryption())
).decode().rstrip('=')

print("=" * 60)
print("Copy these into your .env file:")
print("=" * 60)
print(f"VAPID_PUBLIC_KEY={pub}")
print(f"VAPID_PRIVATE_KEY={priv}")
print("=" * 60)
