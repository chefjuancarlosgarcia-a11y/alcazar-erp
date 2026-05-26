@echo off
cd /d "%~dp0"
echo.
echo Iniciando frontend de Alcazar Inventario...
echo.
echo Cuando Vite termine de cargar, abre:
echo   http://localhost:5173
echo.
echo Desde otro dispositivo en la misma red Wi-Fi usa el link "Network"
echo que aparecera abajo, por ejemplo:
echo   http://192.168.x.x:5173
echo.
echo IMPORTANTE: deja esta ventana abierta.
echo.
"C:\Program Files\nodejs\npm.cmd" run dev -- --host 0.0.0.0
echo.
echo El servidor se detuvo o hubo un error.
pause
