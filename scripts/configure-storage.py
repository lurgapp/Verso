#!/usr/bin/env python3
"""Create Garage config from local .env without printing secrets."""
from pathlib import Path
import os, re
os.umask(0o077)
root=Path(__file__).resolve().parent.parent
values={}
for line in (root/'.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        key,value=line.split('=',1)
        values[key]=value.strip()
secret=values.get('GARAGE_RPC_SECRET','')
if not re.fullmatch('[a-f0-9]{64}',secret):
    raise SystemExit('Set GARAGE_RPC_SECRET to 64 random hex characters in .env.')
(root/'garage.toml').write_text(f'''metadata_dir = "/data/meta"
data_dir = "/data/objects"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "0.0.0.0:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "{secret}"
[s3_api]
s3_region = "garage"
api_bind_addr = "0.0.0.0:3900"
root_domain = ".s3.verso.internal"
''')
(root/'garage.toml').chmod(0o600)
print('Private Garage configuration created.')
