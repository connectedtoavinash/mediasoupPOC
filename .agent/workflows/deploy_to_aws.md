---
title: Deploy Mediasoup POC to AWS
description: Detailed guide to deploy the application on an AWS EC2 instance with SSL.
---

# Deploy Mediasoup POC to AWS (Production Ready)

This guide details how to deploy the Mediasoup POC to an AWS EC2 instance, including SSL configuration (required for WebRTC) and process management.

## Prerequisites
- **AWS Account** with access to launch EC2 instances.
- **Domain Name** (e.g., `yourdomain.com`) pointing to the Public IP of your instance. *Required for SSL.*
- **SSH Client** (Terminal/PuTTY).

## Step 1: Launch EC2 Instance

1.  **Login to AWS Console** -> **EC2**.
2.  **Launch Instance**:
    - **Name**: `mediasoup-poc`
    - **AMS**: Ubuntu Server 24.04 LTS (HVM), SSD Volume Type.
    - **Instance Type**: `t3.small` (Recommended) or `t2.micro` (Free tier eligible, but may be slow for builds).
    - **Key Pair**: Create new or use existing.
    - **Network**:
        - Create Security Group `mediasoup-sg`.
        - Allow **SSH** (TCP 22) - My IP.
        - Allow **HTTP** (TCP 80) - Anywhere `0.0.0.0/0`.
        - Allow **HTTPS** (TCP 443) - Anywhere `0.0.0.0/0`.
        - **CRITICAL**: Allow **Custom UDP** (Range `2000-2020`) - Anywhere `0.0.0.0/0` (Mediasoup Media Traffic).

3.  **Allocate Elastic IP** (Optional but recommended):
    - Go to **Elastic IPs** -> Allocate.
    - Associate it with your new instance.
    - Update your Domain DNS (A Record) to point to this Public IP.

## Step 2: Server Setup

SSH into your instance:
```bash
ssh -i "your-key.pem" ubuntu@<public-ip>
```

Update and install system dependencies:
```bash
sudo apt update && sudo apt upgrade -y
# Install build tools, python (for mediasoup), and Nginx (for SSL proxy)
sudo apt install -y build-essential python3-pip net-tools nginx
```

Install **Node.js 18+**:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Install **Certbot** (for SSL):
```bash
sudo apt install -y certbot python3-certbot-nginx
```

## Step 3: Deploy Application Code

Clone the repository:
```bash
git clone <your-repo-url>
cd mediasoup-poc
```
*Alternatively, use SCP/SFTP to upload your local project folder.*

Install dependencies:
```bash
# Installs root, server, and client dependencies
npm run install:all
```

Build the Client:
```bash
# The server is configured to serve the static files from client/dist
cd client
npm run build
cd ..
```

## Step 4: Configure Nginx (Reverse Proxy)

Create an Nginx config file to proxy traffic from port 80/443 to your Node.js app (Port 3001).

```bash
sudo nano /etc/nginx/sites-available/mediasoup
```

Paste the following configuration (replace `yourdomain.com` with your actual domain):

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the configuration and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/mediasoup /etc/nginx/sites-enabled/
# Remove default if it exists
sudo rm /etc/nginx/sites-enabled/default
# Test config
sudo nginx -t
# Restart
sudo systemctl restart nginx
```

## Step 5: Setup SSL (HTTPS)

Run Certbot to automatically configure SSL certificates:
```bash
sudo certbot --nginx -d yourdomain.com
```
- Enter your email when prompted.
- Certbot will automatically update the Nginx config to serve HTTPS and redirect HTTP.

## Step 6: Run Application with PM2

Install PM2 globally to manage the Node.js process:
```bash
sudo npm install -g pm2
```

Start the application:
*Note: Mediasoup needs `ANNOUNCED_IP` to be the Public IP.*

```bash
cd server

# Start app with Public IP (auto-detected)
ANNOUNCED_IP=$(curl -s http://checkip.amazonaws.com) pm2 start src/server.js --name mediasoup-app

# Make PM2 start on boot
pm2 save
pm2 startup
```

## Step 7: Verification

1.  Open your browser and go to `https://yourdomain.com`.
2.  Click "Join Room" and allow Camera/Mic permissions.
    - *Common Issue*: If not using HTTPS, browsers will block media access.
3.  Open a second device (e.g., phone on 4G) and join the same room.
4.  Verify you can see and hear each other.

## Troubleshooting

- **Media Fails (Black Video/No Audio)**:
    - Check AWS Security Group: Ensure **UDP 2000-2020** is open to 0.0.0.0/0.
    - Check `ANNOUNCED_IP`: Run `pm2 logs mediasoup-app` and verify the IP matches your public IP.
- **502 Bad Gateway**:
    - App might be down. Check `pm2 status`.
    - Check logs: `pm2 logs`.
- **Nginx Errors**: `sudo tail -f /var/log/nginx/error.log`.
