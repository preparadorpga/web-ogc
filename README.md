# web-ogc · paquete de la web de Preparador OGC

Esta carpeta la lee sola la web https://organizacionygestioncomercial.es (plugin «OGC Páginas» 2.0.0 o posterior).

- `sync/manifiesto.json`: todas las páginas nuevas, los campos de Yoast, las imágenes y el HTML de las páginas que
  posicionan (shortcode `[ogc_pagina id="portada"]`).
- `sync/manifiesto.sig`: firma Ed25519 de los bytes exactos de `manifiesto.json`. Sin una firma válida, la web no
  aplica nada. **No edites estos archivos a mano**: se generan con `publicar_sync.py`.
- `sync/img/`: imágenes (solo png, jpg y webp) que lista el manifiesto, con su sha256.
- `materiales/`: paquete CIFRADO del material de venta (AES-256-GCM, un archivo por documento) con manifiesto firmado;
  lo descarga el plugin «OGC Ventas» 1.1 y lo publica `ventas/publicar_materiales.py`. La clave no está aquí.

Cada hora la web descarga el manifiesto, verifica la firma con su clave pública, comprueba que la «serie» sea más
nueva que la aplicada y, si todo está bien, sincroniza las páginas igual que el botón «Sincronizar» del plugin.

Aquí nunca va la clave privada.
