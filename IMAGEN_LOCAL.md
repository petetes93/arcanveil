# Retratos pintados en tu equipo

ARCANVEIL no pide imágenes por su cuenta. Un retrato se pinta **cuando lo pides** («Pintar retrato» al crear el personaje, en la ficha o en cada compañero; nunca en combate) y **solo se queda si lo eliges**:

1. «Pintar» pide una candidata al generador de tu PC. Se ve en una ventana aparte y es privada: no se guarda ni se envía a ningún sitio.
2. «Otra versión» pide otra (otra semilla, el mismo encargo).
3. «Usar esta versión» la guarda en el navegador (IndexedDB) y pasa a verse en la ficha, el grupo y el combate. Sigue ahí al recargar y sin red.

Mientras no eliges ninguna, se ve un marcador con la inicial y el nombre. Los enemigos usan su imagen elegida, la ilustración que trae el juego si la hay, o el marcador. No hay servicio de fuera de respaldo: sin generador, se juega igual.

## Preparar el generador (Windows)

Con ComfyUI instalado, abre PowerShell en ARCANVEIL y ejecuta:

```powershell
.\tools\configurar-imagen-local.ps1 -InstalarModelo
```

El instalador lee GPU, VRAM y RAM. Elige FLUX.1-schnell FP8 con NVIDIA y 12 GB o más, SDXL con 8 GB o más, y un perfil CPU reducido si no hay GPU apta. Guarda la decisión en `.arcanveil-image-config.json`; se puede forzar con `-Perfil flux`, `-Perfil sdxl` o `-Perfil cpu`. También acepta `-ComfyUI C:\ruta\a\ComfyUI` y `-Modelo nombre.safetensors`.

Después abre ComfyUI, que debe responder en `http://127.0.0.1:8188`, y desde la carpeta de ARCANVEIL ejecuta:

```powershell
node tools/imagen-local-proxy.mjs
```

Abre ARCANVEIL (en `http://localhost:8080` o `http://127.0.0.1:8080`: el puente acepta los dos nombres de tu equipo) y pulsa «Pintar retrato». Si algo falta, el estudio lo dice: sin puente, puente sin ComfyUI, otro programa en el puerto o el puente arrancado para otra dirección. La primera generación tarda más; repetir la misma versión sale de `%LOCALAPPDATA%\arcanveil\imagenes`.

## Estilo

Pintura digital de fantasía oscura, anatomía creíble, luz de cine y fondo con atmósfera; nada de anime, dibujo animado, pixel art ni vector (ver `ESTILO` y `NEGATIVO` en `tools/imagen-local-proxy.mjs`). La descripción se traduce al inglés con el glosario de `src/art/rasgos.js`: si nombra especie, manda su especie y no el linaje de la ficha. La versión del estilo (`pintura-oscura-1`) se guarda con cada imagen elegida. **Pendiente:** ajustar el estilo a la imagen de referencia de Alejandro, que no ha llegado.

## Variables opcionales

- `COMFY_URL`: dirección de ComfyUI. Predeterminada `http://127.0.0.1:8188`.
- `ARCANVEIL_IMAGE_PORT`: puerto del puente. Predeterminado `11437` (el `11436` es del puente de Groq). La app busca el puente en el `11437`.
- `ARCANVEIL_ORIGIN`: origen de la app. Predeterminado `http://localhost:8080` (vale también `http://127.0.0.1:8080`). El puente rechaza cualquier otro origen y cualquier `Host` que no sea de loopback antes de generar nada.
- `ARCANVEIL_IMAGE_MODEL`: nombre exacto del checkpoint instalado.
- `ARCANVEIL_IMAGE_PROVIDER=cloudflare` con `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`: Workers AI (flux-1-schnell). **Preparado, no activado**: usarlo necesita cuenta y token, y eso lo decide Alejandro. El token solo vive en el proceso del puente.

Con ComfyUI todo ocurre en loopback y en el PC: no hay claves, cuenta, API remota ni coste por imagen.
