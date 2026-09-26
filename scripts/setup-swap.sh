#!/bin/bash
# ============================================================
# LUMARK CRM — Setup de Swap para VPS de bajo consumo
# Ejecutar como root: sudo bash scripts/setup-swap.sh
#
# Crea 2 GB de swap y los hace permanentes.
# swappiness=10 → solo se usa swap cuando la RAM está al ~90%.
# ============================================================

set -e

SWAP_SIZE="2G"
SWAP_FILE="/swapfile"

echo "=== LUMARK CRM — Configurando Swap de $SWAP_SIZE ==="

# Verificar que no exista ya swap activo
if [ "$(swapon --show | wc -l)" -gt 1 ]; then
    echo "⚠️  Ya hay swap activo:"
    swapon --show
    echo ""
    read -p "¿Deseas continuar y reemplazar? (s/N): " CONFIRM
    if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
        echo "Cancelado."
        exit 0
    fi
    swapoff -a 2>/dev/null || true
    rm -f "$SWAP_FILE"
fi

# Crear archivo de swap
echo "→ Creando archivo de swap ($SWAP_SIZE)..."
fallocate -l $SWAP_SIZE $SWAP_FILE
chmod 600 $SWAP_FILE

# Formatear como swap
echo "→ Formateando como swap..."
mkswap $SWAP_FILE

# Activar swap
echo "→ Activando swap..."
swapon $SWAP_FILE

# Hacer permanente (sobrevive reinicios)
echo "→ Configurando persistencia en /etc/fstab..."
if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
fi

# Configurar swappiness (solo usar swap cuando sea necesario)
echo "→ Configurando swappiness=10..."
if grep -q "vm.swappiness" /etc/sysctl.conf; then
    sed -i 's/vm.swappiness=.*/vm.swappiness=10/' /etc/sysctl.conf
else
    echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

# Aplicar cambio sin reiniciar
sysctl -p 2>/dev/null || true

# Verificar
echo ""
echo "=== Swap configurado exitosamente ==="
echo ""
echo "Estado actual:"
free -h
echo ""
echo "Swap activo:"
swapon --show
echo ""
echo "Persistencia verificada:"
grep "$SWAP_FILE" /etc/fstab
echo ""
echo "✅ Listo. Tu VPS ahora tiene 2 GB de swap como buffer para picos de memoria."
