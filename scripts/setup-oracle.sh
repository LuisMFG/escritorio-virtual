#!/usr/bin/env bash
# Prepara uma VM Ubuntu da Oracle Cloud (Always Free) para rodar o escritório.
# Rode UMA vez, na própria VM (o deploy.sh faz isso por você com --setup):
#   bash setup-oracle.sh
# É seguro rodar de novo: cada passo verifica se já foi feito.
set -euo pipefail

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  # Script oficial de instalação do Docker (docker.com).
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "==> Firewall interno (as imagens Ubuntu da Oracle bloqueiam tudo menos SSH)"
if ! dpkg -s iptables-persistent >/dev/null 2>&1; then
  echo iptables-persistent iptables-persistent/autosave_v4 boolean true | sudo debconf-set-selections
  echo iptables-persistent iptables-persistent/autosave_v6 boolean true | sudo debconf-set-selections
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
fi
open_port() {
  local proto="$1" port="$2"
  if sudo iptables -C INPUT -p "$proto" --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    return
  fi
  # Insere antes da regra REJECT final (se existir); senão, no fim.
  local pos
  pos="$(sudo iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')"
  if [ -n "$pos" ]; then
    sudo iptables -I INPUT "$pos" -p "$proto" --dport "$port" -m state --state NEW -j ACCEPT
  else
    sudo iptables -A INPUT -p "$proto" --dport "$port" -m state --state NEW -j ACCEPT
  fi
  echo "    porta $proto/$port liberada"
}
open_port tcp 80
open_port tcp 443
open_port udp 443
sudo netfilter-persistent save >/dev/null

echo "==> Swap (máquinas de 1 GB precisam para o build)"
mem_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$mem_mb" -lt 3000 ] && ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "    swap de 2 GB criado"
fi

mkdir -p "$HOME/escritorio/data"
echo "==> Pronto. Saia e entre de novo no SSH para o grupo docker valer."
