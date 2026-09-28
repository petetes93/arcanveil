# Retratos generados localmente

ARCANVEIL puede sustituir el retrato procedural por una pintura generada en tu PC a partir del linaje, la descripción libre y una semilla estable. Si el generador está apagado, la app conserva el retrato procedural y nunca queda en blanco.

## Detección automática en Windows

Con ComfyUI instalado, abre PowerShell en ARCANVEIL y ejecuta:

```powershell
.\tools\configurar-imagen-local.ps1 -InstalarModelo
```

El instalador lee GPU, VRAM y RAM. Elige FLUX.1-schnell FP8 con NVIDIA y 12 GB o más, SDXL con 8 GB o más, y un perfil CPU reducido si no hay GPU apta. Guarda la decisión en `.arcanveil-image-config.json`; se puede forzar con `-Perfil flux`, `-Perfil sdxl` o `-Perfil cpu`. También acepta `-ComfyUI C:\ruta\a\ComfyUI` y `-Modelo nombre.safetensors`.

Después abre ComfyUI, que debe responder en `http://127.0.0.1:8188`, y desde la carpeta de ARCANVEIL ejecuta:

```powershell
node tools/imagen-local-proxy.mjs
```

Abre ARCANVEIL normalmente. Al escribir al menos 8 caracteres en la descripción, la vista procedural aparece de inmediato y la pintura local la sustituye al terminar. La primera generación tarda más; las siguientes con los mismos criterios salen de `.arcanveil-images`.

Variables opcionales:
- `COMFY_URL`: dirección de ComfyUI. Predeterminada `http://127.0.0.1:8188`.
- `ARCANVEIL_IMAGE_PORT`: puerto del puente. Predeterminado `11437` (el `11436` es del puente de Groq).
- `ARCANVEIL_ORIGIN`: origen exacto de la app. Predeterminado `http://localhost:8080`. El puente rechaza cualquier otro origen y cualquier `Host` que no sea de loopback antes de generar nada.
- `ARCANVEIL_IMAGE_MODEL`: nombre exacto del checkpoint instalado.

Todo ocurre en loopback y en el PC. No hay claves, cuenta, API remota ni coste por imagen.
