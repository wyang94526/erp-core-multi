# Step-by-step install (Linux and Windows Server)

The application runs as **Linux containers**. A dedicated Windows Server hosts an Ubuntu VM; you then follow the Linux steps **inside that VM**.

Commit and push the production Docker files before cloning on a server. Until they are on GitHub, a fresh clone will not contain `docker-compose.prod.yml`.

**Hardware (either path):** 4+ vCPU, 16 GB RAM, 100 GB+ SSD, static IP, outbound HTTPS (image pulls; OpenAI if used).

---

## Path 1 — Linux server (Ubuntu 24.04 LTS)

Do these on the machine that will serve the ERP (or inside the Windows Hyper-V VM from Path 2).

### 1. Install the OS

1. Install **Ubuntu Server 24.04 LTS**.
2. Create a sudo user. Do not stay logged in as `root`.
3. Enable OpenSSH when the installer asks.
4. Set hostname (example: `erp-prod`).
5. Set a **static IPv4** (installer network screen, or Netplan after first boot).
6. Reboot and SSH in as the sudo user.

### 2. Update the OS

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git ufw openssl
```

### 3. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Do **not** open 5432, 8000, or 5050.

### 4. Install Docker Engine and Compose

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

Log out and SSH back in (required for the `docker` group), then:

```bash
docker version
docker compose version
```

Both commands should succeed without `sudo`.

### 5. Clone the repo

```bash
sudo mkdir -p /opt
sudo git clone https://github.com/wyang94526/erp-project.git /opt/erp-project
sudo chown -R "$USER:$USER" /opt/erp-project
cd /opt/erp-project
```

Confirm these files exist: `docker-compose.prod.yml`, `backend/Dockerfile`, `erp-frontend/Dockerfile`, `.env.example`. If they are missing, the production commit is not on `main` yet.

### 6. Create `.env`

```bash
cp .env.example .env
chmod 600 .env
```

Generate a JWT secret and a database password:

```bash
openssl rand -hex 32
openssl rand -base64 24
```

Edit the file:

```bash
nano .env
```

Set at least:

```
POSTGRES_PASSWORD=<the base64 value, avoid the $ character>
JWT_SECRET=<the hex value>
ENVIRONMENT=production
CORS_ORIGINS=
```

Leave `POSTGRES_USER=erp_admin` and `POSTGRES_DB=erp_system` unless you have a reason to change them. Leave `POSTGRES_HOST=localhost` in the file; Compose overrides it to `postgres` for the API container.

Optional: set `OPENAI_API_KEY` for the AI assistant.

Save and exit (`Ctrl+O`, Enter, `Ctrl+X`).

### 7. Start the stack

First build can take several minutes (Python deps + frontend `npm run build`).

```bash
cd /opt/erp-project
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

`postgres`, `api`, and `web` should be `running` / healthy.

```bash
curl -fsS http://127.0.0.1/health
```

Expect: `{"status":"ok","service":"erp-api"}`.

If that fails:

```bash
docker compose -f docker-compose.prod.yml logs --tail=80 api web postgres
```

### 8. Open the UI and create an admin

Browse to `http://<linux-or-vm-ip>/`.

1. Register with your work email. Do **not** run `python backend/seed_db.py`.
2. Promote that user (replace the email):

```bash
cd /opt/erp-project
set -a && . ./.env && set +a
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "INSERT INTO user_roles (user_id, role_id)
   SELECT id, 'ROLE-ADMIN' FROM users WHERE email = 'you@company.com'
   ON CONFLICT DO NOTHING;"
```

3. Log out and log in again so the new JWT includes `ROLE-ADMIN`.

### 9. Smoke checks

| Check | Expect |
|---|---|
| `http://<ip>/health` | JSON `status: ok` |
| `http://<ip>/` | Login / register |
| Refresh a deep link after login | Page still loads |
| Create a sales or purchase order, then `docker compose -f docker-compose.prod.yml restart` | Row still there |

---

## Path 2 — Dedicated Windows Server (Hyper-V + Ubuntu)

Windows is the hypervisor. The ERP does **not** run as Windows containers and **not** under Docker Desktop.

If this Windows Server is **itself a VM**, nested virtualization must be enabled or Path 2 will fail. Use Path 1 on a Linux VM from your hypervisor instead.

### 1. Install Windows Server

1. Install **Windows Server 2022 or 2025** with **Desktop Experience**.
2. Complete OOBE, set an Administrator password.
3. Set hostname (example: `ERP-WIN`).
4. Set a **static IP** on the management NIC.
5. Join the domain only if your IT requires it (not required for the app).
6. Run **Windows Update** until it is current. Reboot.

Restrict RDP to your admin network (Windows Firewall inbound rule, or a jump host).

### 2. Enable Hyper-V

Elevated PowerShell:

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

The host reboots.

### 3. Create an external virtual switch

Do this from the **console** (or a second NIC). Binding the RDP NIC as an external switch can drop your RDP session.

```powershell
Get-NetAdapter
```

Note the LAN adapter **Name** (often `Ethernet` or `Ethernet 2`).

```powershell
New-VMSwitch -Name "ERP-External" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

Replace `Ethernet` with the name from `Get-NetAdapter`.

### 4. Download Ubuntu ISO

On the Windows host, download **Ubuntu Server 24.04 LTS** (`ubuntu-24.04.x-live-server-amd64.iso`) from https://ubuntu.com/download/server and save it as:

`C:\ISO\ubuntu-24.04-live-server-amd64.iso`

Create `C:\ISO` if needed.

### 5. Create the VM

Elevated PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path C:\Hyper-V\erp-linux | Out-Null

New-VM -Name erp-linux -Generation 2 `
  -MemoryStartupBytes 8GB `
  -NewVHDPath C:\Hyper-V\erp-linux\erp-linux.vhdx `
  -NewVHDSizeBytes 80GB `
  -SwitchName "ERP-External"

Set-VMProcessor erp-linux -Count 4
Set-VMMemory erp-linux -DynamicMemoryEnabled $false
Set-VMFirmware erp-linux -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority
Add-VMDvdDrive -VMName erp-linux -Path C:\ISO\ubuntu-24.04-live-server-amd64.iso
Start-VM erp-linux
vmconnect localhost erp-linux
```

If `vmconnect` is not found, open **Hyper-V Manager** → `erp-linux` → Connect.

### 6. Install Ubuntu in the VM

In the installer:

1. English, Continue.
2. Keyboard, Continue.
3. Network: assign a **static IP on the same LAN** as users (or DHCP reservation). This is the address people will type in the browser.
4. Use an entire disk; confirm.
5. Profile: your name, server name `erp-linux`, sudo username, strong password.
6. **Install OpenSSH server** = yes.
7. Do not install extra snaps. Finish and reboot.
8. At the firmware boot menu, boot from the disk (eject/unmount the ISO if it loops the installer):

```powershell
Get-VMDvdDrive -VMName erp-linux | Set-VMDvdDrive -Path $null
```

### 7. SSH into the VM and follow Path 1

From your laptop (or the Windows host):

```bash
ssh youruser@<vm-lan-ip>
```

Then run **Path 1, steps 2 through 9** on the VM. Users browse to `http://<vm-lan-ip>/`.

You do **not** need to open port 80 on the Windows host firewall if clients talk to the VM IP. Keep RDP locked down on Windows.

### Windows 10/11 box (not Server)

1. Install Docker Desktop with the **WSL2** backend.
2. Settings → General → Start Docker Desktop when you log in.
3. Clone the repo (Git for Windows or WSL).
4. `cp .env.example .env`, set `POSTGRES_PASSWORD` and `JWT_SECRET`.
5. `docker compose -f docker-compose.prod.yml up -d --build`
6. Open `http://localhost/` or `http://<windows-ip>/`.

---

## Updates (Linux host or VM)

```bash
cd /opt/erp-project
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Do not re-run `init-scripts` on an existing database volume (they `DROP` tables).

## Backups

```bash
cd /opt/erp-project
set -a && . ./.env && set +a
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$HOME/erp-$(date +%F).dump"
```

Keep `.env` in a secret store, not in git.

## TLS (after HTTP works)

Point a DNS name at the Linux/VM IP. Put Caddy or nginx on that host as a TLS reverse proxy to `127.0.0.1:80`, or mount certificates into the `web` service. Use HTTPS if the ERP is reachable off the LAN.

## Local development (your laptop)

Unchanged: `docker compose up -d` (Postgres + pgAdmin only), then uvicorn and `npm run dev`. Do not copy `.env.example` over your existing laptop `.env`.
