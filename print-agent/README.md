# Print Agent

Prueba local de impresion ESC/POS por red o por impresora instalada en Windows. No toca el ERP.

## Uso

1. Crea `print-agent/.env` usando `.env.example`.
2. Configura el modo de impresion.
3. Ejecuta:

```bash
npm run test-print
```

Desde esta carpeta tambien puedes ejecutar:

```bash
node test-print.js
```

## Modo Windows

Lista las impresoras instaladas:

```bash
wmic printer get name
```

Para caja por USB, configura:

```env
PRINT_MODE=windows
WINDOWS_PRINTER_NAME=CAJA
```

Nombres conocidos en caja:

```text
CAJA
COCINA
BARRA
CAFE
Estacion
MesaCaliente
```

El script genera un archivo temporal `.bin` con ESC/POS y lo envia como RAW a la impresora de Windows.

## Modo TCP/IP

Configura:

```env
PRINT_MODE=tcp
PRINTER_IP=192.168.x.x
PRINTER_PORT=9100
```

El puerto usual para impresoras ESC/POS por red es `9100`.
