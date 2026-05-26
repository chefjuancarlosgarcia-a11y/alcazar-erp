# Acceso en red local

Esta guía permite abrir el frontend de Pizzería El Gran Alcázar desde otros dispositivos conectados a la misma red Wi-Fi o red local.

## Ejecutar el frontend

Desde la carpeta `frontend`:

```bash
npm run dev
```

Vite está configurado para escuchar en todas las interfaces:

```js
server: {
  host: "0.0.0.0",
  port: 5173
}
```

## URLs esperadas

Al iniciar el servidor verás algo similar:

```text
Local:   http://localhost:5173
Network: http://192.168.1.45:5173
```

Usa `Local` en la computadora donde corre el servidor.
Usa `Network` en teléfonos, tablets o laptops conectadas a la misma red.

## Encontrar la IP local manualmente

En Windows puedes ejecutar:

```powershell
ipconfig
```

Busca la dirección `IPv4` de tu adaptador Wi-Fi. Normalmente luce así:

```text
192.168.1.45
```

Luego abre desde otro dispositivo:

```text
http://IP_LOCAL:5173
```

Ejemplo:

```text
http://192.168.1.45:5173
```

## Firewall

Si otro dispositivo no puede entrar:

- Confirma que ambos dispositivos están en la misma red Wi-Fi.
- Revisa que Windows Firewall permita Node.js o Vite en redes privadas.
- Asegúrate de usar `http`, no `https`.
- Verifica que el servidor siga activo en la computadora principal.
- Si el puerto `5173` está ocupado, Vite mostrará un error porque el puerto está fijado. Detén procesos anteriores o reinicia el servidor.

## Reiniciar servidor

En la terminal donde corre Vite:

```text
Ctrl + C
npm run dev
```

## Banner de desarrollo

En modo development el frontend muestra una tarjeta flotante discreta con:

- acceso local `localhost`
- acceso por IP local de red

Esa tarjeta no aparece en builds de producción.
