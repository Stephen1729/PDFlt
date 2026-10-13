# 📱 Plan Maestro de Desarrollo UI/UX — PDFlt Android

**Proyecto:** PDFlt para Android (Capacitor + TypeScript + Vite + PDF.js + pdf-lib)  
**Versión actual auditada:** `v1.3.2`  
**Objetivo:** Transformar la interfaz híbrida actual en una experiencia móvil de nivel nativo, corrigiendo inconsistencias de estilos y lógica, eliminando fricciones táctiles y optimizando los flujos de trabajo de documentos en Android.

---

## 📋 Índice

1. [Resumen Ejecutivo y Estado Actual](#1-resumen-ejecutivo-y-estado-actual)
2. [Fase 0: Auditoría Técnica de Bugs Silenciosos (Crítico)](#2-fase-0-auditoría-técnica-de-bugs-silenciosos-crítico)
3. [Sprint 1: Sistema de Diseño, Variables CSS y Feedback Visual](#3-sprint-1-sistema-de-diseño-variables-css-y-feedback-visual)
4. [Sprint 2: Ergonomía Táctil y Flujo en Herramientas PDF](#4-sprint-2-ergonomía-táctil-y-flujo-en-herramientas-pdf)
5. [Sprint 3: Optimización de UX y Rendimiento en el Escáner](#5-sprint-3-optimización-de-ux-y-rendimiento-en-el-escáner)
6. [Sprint 4: Arquitectura de Navegación Nativa y Acciones Post-Guardado](#6-sprint-4-arquitectura-de-navegación-nativa-y-acciones-post-guardado)
7. [Matriz de Archivos a Modificar y Checklist de Implementación](#7-matriz-de-archivos-a-modificar-y-checklist-de-implementación)

---

## 1. Resumen Ejecutivo y Estado Actual

### Fortalezas actuales del código
* **Motor de Escaneo Avanzado (`scan.ts`):** Cuenta con recorte perspectivo interactivo de 4 esquinas y 4 bordes medios, lupa de aumento en tiempo real (`crop-loupe`) y transformación por homografía (`warpPerspective`).
* **Flujo Encadenado (*Tool Chaining* en `pdfService.ts`):** El modal `promptSaveDialog` permite pasar el resultado de una herramienta directamente a otra (por ejemplo, de *Escanear* a *Comprimir*) preservando el historial de retorno (`returnTo`).
* **Procesamiento 100% Local (`pdfService.ts`):** Uso eficiente de `fileCache` en memoria para evitar lecturas/escrituras innecesarias en el sistema de archivos durante pasos intermedios.

### Problemas principales detectados
A pesar de la solidez funcional, la aplicación arrastra comportamientos heredados de una interfaz de escritorio (Desktop/Electron) que penalizan la experiencia en pantallas táctiles:
1. **Variables CSS inexistentes** que dejan componentes clave sin estilos visibles.
2. **Desincronización de tipos** en la herramienta de compresión que impide usar uno de los modos.
3. **Colisión de gestos táctiles** entre el desplazamiento vertical (*scroll*) y el arrastre de elementos (*drag & drop*).
4. **Callejones sin salida (*Dead-ends*)** al cargar un archivo equivocado o al finalizar el guardado de un PDF.

---

## 2. Fase 0: Auditoría Técnica de Bugs Silenciosos (Crítico)

Antes de introducir mejoras estéticas, es indispensable corregir **4 errores técnicos** presentes actualmente en el código fuente:

### 2.1. Variables CSS huérfanas (No declaradas en `theme.css`)
En `src/renderer/src/styles/theme.css` se definen `--accent`, `--bg-card`, `--bg-secondary` y `--text-primary`. Sin embargo, en múltiples vistas y hojas de estilo se invocan variables que **no existen**:

| Variable invocada | Archivos donde aparece | Impacto visual actual |
| :--- | :--- | :--- |
| `var(--primary)` | `scan.ts` (líneas 168, 240, 845), `compress.ts` (líneas 77, 86), `components.css` (línea 106) | La barra de progreso de compresión (`#progress-bar`), el borde de la tarjeta `.compression-card.selected` y varios íconos quedan **transparentes/invisibles**. |
| `var(--bg-tertiary)` | `compress.ts` (línea 76), `components.css` (líneas 100, 650, 682) | El fondo contenedor de la barra de progreso y los botones de encadenamiento (`save-modal-chain-btn`) carecen de color de fondo. |
| `var(--bg-surface)` | `merge.ts` (línea 130) | Las tarjetas `.file-item` de la lista de PDFs a unir quedan con fondo transparente, dejando ver las órbitas animadas de fondo sin contraste. |
| `var(--text)` | `compress.ts` (línea 43), `components.css` (línea 116) | Títulos de tarjetas de compresión y peso del archivo usan el color heredado por defecto en lugar del token primario. |

### 2.2. Bug de Lógica en Compresión (`compress.ts` vs `types.ts`)
* **En `src/shared/types.ts` (línea 23):**
  ```ts
  export type CompressionLevel = 'extreme' | 'recommended' | 'basic'
  ```
* **En `src/renderer/src/views/compress.ts` (línea 63):**
  La tercera tarjeta ("Suave - 300 DPI") tiene el atributo HTML `data-level="low"`.
* **En `src/renderer/src/views/compress.ts` (línea 199 y 216):**
  ```ts
  if (selectedLevel === 'basic') {
    // Nunca entra aquí porque el HTML asigna 'low'
  } else {
    const scale = selectedLevel === 'extreme' ? 1.0 : 1.5
    const quality = selectedLevel === 'extreme' ? 0.6 : 0.8
  }
  ```
* **Consecuencia:** Seleccionar la tarjeta **"Suave (300 DPI)"** asigna `'low'` a `selectedLevel`. Al no coincidir con `'basic'` ni tener una condición ternaria propia para `'low'`, **ejecuta exactamente la misma compresión que "Equilibrada (150 DPI)"** (`scale: 1.5`, `quality: 0.8`).

### 2.3. Superposición de Notificaciones Toast sobre Controles Móviles (`global.css`)
* **En `src/renderer/src/styles/global.css` (líneas 105-113):**
  ```css
  #notification-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
  }
  ```
* **Consecuencia:** En Android, la franja inferior de `0px` a `130px` está ocupada por la barra de navegación (`.bottom-nav`) y la barra de acción contextual (`.action-bar` con el botón "Guardar PDF"). Posicionar los Toasts a `bottom: 24px` tapa directamente el botón principal de acción o la pestaña "Más".

### 2.4. Ocultamiento de Información Esencial en Móvil (`components.css`)
* **En `src/renderer/src/styles/components.css` (línea 305):**
  ```css
  .action-bar .page-info {
    display: none; /* Hide on mobile to save vertical space */
  }
  ```
* **Consecuencia:** Como se trata de una app compilada para Android (donde casi el 100% de los teléfonos tienen menos de `600px` de ancho lógico en vertical), el usuario **jamás ve**:
  * Cuántas páginas lleva seleccionadas en `split.ts` (`#selection-info`).
  * El aviso `"X páginas · orden modificado"` en `reorder.ts` (`#page-info`).
  * El resumen `"X archivos · Y páginas totales"` en `merge.ts` (`#merge-info`).

---

## 3. Sprint 1: Sistema de Diseño, Variables CSS y Feedback Visual

### Objetivo
Unificar los tokens de diseño en `theme.css`, mejorar la jerarquía cromática de los botones de acción principal, corregir el bug de `compress.ts` y rediseñar las notificaciones Toast para pantallas móviles.

### 3.1. Normalización de Tokens en `theme.css`
Añadir las variables faltantes y definir colores de superficie con mejor separación visual en pantallas OLED/AMOLED:

```css
:root {
  /* ── Background & Surfaces ── */
  --bg-primary: #0f1014;
  --bg-secondary: #181920;
  --bg-tertiary: #23252f;
  --bg-surface: #1c1e26;
  --bg-card: #1f212a;
  --bg-card-hover: #282b36;
  --bg-input: #0a0b0e;

  /* ── Text ── */
  --text-primary: #f3f4f6;
  --text: var(--text-primary);
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;

  /* ── Accent / Primary ── */
  --accent: #3b82f6;
  --primary: var(--accent);
  --accent-hover: #60a5fa;
  --accent-soft: rgba(59, 130, 246, 0.14);
  --accent-glow: rgba(59, 130, 246, 0.28);
}
```

### 3.2. Jerarquía de Botones y Estados Activos Táctiles (`components.css`)
En dispositivos móviles no existe el estado `:hover` persistente; el usuario necesita feedback inmediato mediante `:active` (reducción sutil de escala al presionar):

```css
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--accent);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px var(--accent-glow);
  transition: transform 0.1s ease, background var(--duration) var(--ease), opacity var(--duration) var(--ease);
}

.btn-primary:active:not(:disabled),
.btn-secondary:active:not(:disabled),
.btn-icon:active:not(:disabled) {
  transform: scale(0.96);
}
```

### 3.3. Reposicionamiento de Toasts Tipo "Floating Pill" Superior (`global.css`)
Mover `#notification-container` a la parte superior (debajo del `.mobile-header`), centrado horizontalmente y respetando el `safe-area-inset-top` de la cámara/notch de Android:

```css
#notification-container {
  position: fixed;
  top: calc(68px + env(safe-area-inset-top, 0px));
  left: 16px;
  right: 16px;
  z-index: 10005;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.notification {
  pointer-events: auto;
  width: 100%;
  max-width: 400px;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 0.88rem;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
```

### 3.4. Reparación de Niveles de Compresión (`types.ts` y `compress.ts`)
1. Actualizar `CompressionLevel` en `types.ts`:
   ```ts
   export type CompressionLevel = 'extreme' | 'recommended' | 'low'
   ```
2. Ajustar la escala de renderizado y calidad JPEG en `compress.ts` para que las 3 tarjetas cumplan exactamente lo que prometen sus descripciones (100 DPI, 150 DPI y 300 DPI):
   ```ts
   const scaleMap: Record<CompressionLevel, number> = {
     extreme: 1.0,      // ~100 DPI
     recommended: 1.5,  // ~150 DPI
     low: 2.2           // ~250-300 DPI
   }
   const qualityMap: Record<CompressionLevel, number> = {
     extreme: 0.55,
     recommended: 0.78,
     low: 0.90
   }
   const scale = scaleMap[selectedLevel] ?? 1.5
   const quality = qualityMap[selectedLevel] ?? 0.78
   ```

---

## 4. Sprint 2: Ergonomía Táctil y Flujo en Herramientas PDF

### Objetivo
Mejorar la manipulación de archivos y páginas en `merge.ts`, `split.ts`, `reorder.ts` y `compress.ts`, evitando errores de interacción táctil y callejones sin salida.

### 4.1. Cabecera de Documento Unificada con Botón "Cambiar / Cerrar PDF"
* **Problema:** En `split.ts`, `reorder.ts` y `compress.ts`, una vez que se carga un PDF, el `#drop-zone` desaparece y no existe ningún botón en la interfaz para descartar ese PDF y seleccionar otro diferente.
* **Solución:** Crear un componente visual `.document-toolbar` en la parte superior de las vistas con archivo cargado que muestre:
  * Nombre del archivo truncado con elipsis (`text-overflow: ellipsis`).
  * Metadatos en una píldora (`X págs · Y MB`).
  * Botón `"Cambiar"` (o ícono de carpeta/cerrar) que reinicie la vista o abra directamente `handleOpenFile()`.

### 4.2. Separación entre Scroll y Drag & Drop en `merge.ts`
* **Problema:** En `merge.ts` (línea 173), SortableJS usa `handle: '.file-item'`. Toda la tarjeta es arrastrable, lo que dificulta desplazarse por una lista larga de documentos.
* **Solución:**
  1. Asignar la clase `.file-drag-handle` al contenedor del ícono de 6 puntos a la izquierda de cada `.file-item`, dándole un área táctil cómoda (`44x44px`, `touch-action: none`).
  2. Configurar SortableJS con `handle: '.file-drag-handle'` y `delay: 0`. De esta forma, el usuario arrastra instantáneamente desde el manejador izquierdo y hace scroll normal en el resto de la fila.
  3. Añadir numeración visual (`#1`, `#2`, `#3`) a cada archivo en la lista para que quede claro el orden de unión.
  4. Al reordenar en `onEnd`, actualizar los índices del DOM sin reconstruir todo el HTML (`renderFileList()`), evitando que se destruya y recree la instancia de `Sortable` en cada movimiento.

### 4.3. Rediseño de la Barra de Acción en `split.ts` y `reorder.ts`
* **Problema en `split.ts`:** La barra inferior contiene 3 botones (`Seleccionar todas`, `Invertir selección`, `Guardar PDF`). En pantallas móviles estrechas se apilan mal y el contador `#selection-info` está oculto por CSS.
* **Solución en `split.ts`:**
  * Mover `Seleccionar todas` e `Invertir` a una sub-barra de herramientas superior (debajo del nombre del archivo), junto al contador visible `"X de Y seleccionadas"`.
  * Dejar en `.action-bar` inferior únicamente el botón primario `"Extraer páginas (X)"` ocupando el 100% del ancho.
  * Agregar la posibilidad de **seleccionar por rango rápido** (o mantener presionado y deslizar) además del toque individual.
* **Solución en `reorder.ts`:**
  * Mostrar un badge en cada miniatura cuando una página haya cambiado respecto a su posición original (ej. `"Pág. 3 (antes 1)"`), para que el usuario sepa exactamente qué movió antes de guardar.

---

## 5. Sprint 3: Optimización de UX y Rendimiento en el Escáner

### Objetivo
Hacer que el flujo de 3 etapas de `scan.ts` (`drop` ➔ `edit` ➔ `cascade`) sea fluido, previniendo pérdidas accidentales de capturas y bloqueos visuales durante el procesado de imagen.

### 5.1. Overlay de Carga No Bloqueante en `processPageImage()` (`scan.ts`)
* **Problema:** Cuando el usuario rota una foto, aplica un filtro (`Doc. B&N` / `Color+`) o confirma un recorte perspectivo, `warpPerspective()` procesa un Canvas de hasta `1800px` en el hilo principal. Durante esos `300ms - 800ms`, el botón tocado ni siquiera cambia de estilo visual hasta que termina el cálculo pesado, dando la sensación de que el toque no funcionó.
* **Solución:**
  1. Añadir un overlay `.scan-processing-overlay` dentro de `.scan-editor-viewport` con un spinner y el texto `"Procesando imagen..."`.
  2. Crear un helper `runWithUiYield(fn)` que muestre el overlay, espere un doble `requestAnimationFrame` para garantizar que el navegador pinte el estado activo en pantalla, ejecute `processPageImage` y finalmente oculte el overlay:
     ```ts
     async function applyImageChange(container: HTMLElement, page: ScannedPage, renderAfter = false) {
       const loader = document.getElementById('scan-processing-overlay')
       if (loader) loader.style.display = 'flex'
       await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
       try {
         page.processedDataUrl = await processPageImage(page)
       } finally {
         if (loader) loader.style.display = 'none'
       }
       if (renderAfter) renderEditStage(container)
     }
     ```

### 5.2. Protección contra Pérdida de Páginas Escaneadas (`scan.ts` + `router.ts`)
* **Problema:** En `scan.ts`, presionar `"Cancelar"` en el editor (línea 447), tocar `"Borrar todo"` en la cascada (línea 861) o presionar el botón físico "Atrás" desde la primera etapa de edición vacía `scannedPages = []` de forma instantánea. Si el usuario llevaba 10 páginas fotografiadas y recortadas, pierde todo su trabajo por un toque accidental.
* **Solución:**
  * Implementar un modal reutilizable `promptConfirmDialog({ title, message, confirmText, isDanger })` en `router.ts` o `pdfService.ts`.
  * Invocarlo siempre que `scannedPages.length > 0` antes de vaciar el arreglo.

### 5.3. Botón "Aplicar filtro a todas las páginas" en el Escáner (`scan.ts`)
* **Fricción actual:** Si el usuario escanea un documento de 12 páginas y quiere que todas queden en modo `"Doc. B&N"`, actualmente tiene que aplicar el filtro página por página usando los botones `◀ Anterior` y `Siguiente ▶`.
* **Solución:** Añadir en la barra de filtros un botón o acción rápida `"Aplicar a todas"` cuando `scannedPages.length > 1`, procesando en lote todas las páginas con barra de progreso.

---

## 6. Sprint 4: Arquitectura de Navegación Nativa y Acciones Post-Guardado

### Objetivo
Eliminar pasos innecesarios en la navegación principal, mejorar el comportamiento del botón físico "Atrás" de Android y añadir la función de **Compartir PDF** inmediatamente después de procesar un archivo.

### 6.1. Rediseño de `.bottom-nav` y `.mobile-header` (`index.html`, `main.ts`, `router.ts`)
* **Problema:** El menú `"Más"` en la barra inferior solo existe para alojar 2 elementos: `Reordenar páginas` y `Configuración`. Esto oculta una de las 5 herramientas principales del producto (`Reordenar`) detrás de un popover adicional.
* **Solución:**
  1. Colocar las **5 herramientas principales** directamente en `.bottom-nav`:
     * `Escanear` | `Unir` | `Separar` | `Reordenar` | `Comprimir`
  2. Mover el acceso a **`Configuración` (ícono de engranaje)** a la esquina superior derecha de `.mobile-header`, simétrico al botón `#header-back-btn` de la izquierda.
  3. Eliminar el código muerto de `#more-menu-container` y `#more-menu-backdrop`, simplificando `index.html`, `main.ts` y `components.css`.

### 6.2. Acción "Compartir" y Modal de Éxito Post-Guardado (`pdfService.ts`)
* **Problema:** Al guardar un PDF, la app solo escribe el archivo en `Directory.Documents` y muestra un Toast de 3.5 segundos. El usuario no puede abrir ni enviar el PDF recién creado desde la app.
* **Solución:**
  * En `promptSaveDialog` (`pdfService.ts`), o inmediatamente después de guardar, ofrecer la opción **"Guardar y Compartir"** utilizando la Web Share API (`navigator.share` con objeto `File` construido desde el Base64 en caché) o `@capacitor/share` con la URI devuelta por `Filesystem.writeFile`.
  * `Filesystem.writeFile` devuelve `{ uri: string }`. Guardar ese `uri` en `OperationResult` para permitir compartir el archivo nativamente en Android con WhatsApp, Gmail, Drive o visores de PDF externos.

### 6.3. Manejo Inteligente del Botón "Atrás" en Todas las Vistas (`router.ts`)
* **Problema:** En `router.ts` (líneas 56-59), si el usuario está en `merge`, `split`, `reorder` o `compress` y presiona "Atrás", la app salta bruscamente a la vista `'scan'`, incluso si tenía un documento abierto en pantalla.
* **Solución:** Permitir que cada vista registre su propio estado interno o exponer una función `resetCurrentView()` para que:
  1. Si el usuario tiene un PDF cargado en `split` / `reorder` / `compress` / `merge`, el primer gesto "Atrás" cierre el archivo actual (volviendo al `#drop-zone` de esa misma herramienta, previa confirmación si hay cambios sin guardar).
  2. Si ya está en el `#drop-zone` vacío de una pestaña secundaria, el gesto "Atrás" lo lleve a la pestaña principal (`scan`).
  3. Si está en `scan` en la etapa inicial (`drop`), cierre la aplicación (`App.exitApp()`).

---

## 7. Matriz de Archivos a Modificar y Checklist de Implementación

| Sprint | Archivo | Cambios Principales | Impacto |
| :--- | :--- | :--- | :--- |
| **Sprint 1** | `src/renderer/src/styles/theme.css` | Añadir `--primary`, `--bg-tertiary`, `--bg-surface`, `--text` y ajustar contrastes oscuros. | Alto (Corrige bugs visuales en toda la app) |
| **Sprint 1** | `src/renderer/src/styles/global.css` | Reposicionar `#notification-container` arriba respetando `safe-area-inset-top`. | Alto (Evita tapar botones inferiores) |
| **Sprint 1** | `src/renderer/src/styles/components.css` | Mejorar `.btn-primary`, habilitar `.page-info` en móvil, agregar `:active` táctil y transiciones de vista. | Alto |
| **Sprint 1** | `src/shared/types.ts` y `views/compress.ts` | Corregir tipo `'low'` y escalas/calidades de los 3 niveles de compresión. | Crítico (Corrige bug funcional) |
| **Sprint 2** | `src/renderer/src/views/merge.ts` | Activar drag handle dedicado (`.file-drag-handle`), numerar filas y optimizar Sortable. | Medio-Alto |
| **Sprint 2** | `src/renderer/src/views/split.ts` | Reubicar botones de selección masiva al header, añadir botón "Cambiar PDF". | Alto |
| **Sprint 2** | `src/renderer/src/views/reorder.ts` | Añadir botón "Cambiar PDF" y badge indicador de páginas movidas. | Medio |
| **Sprint 3** | `src/renderer/src/views/scan.ts` | Añadir overlay de carga en filtros/recorte, botón "Aplicar filtro a todas" y confirmación al descartar. | Alto |
| **Sprint 4** | `src/renderer/index.html` y `main.ts` | Pasar las 5 herramientas a `.bottom-nav` y mover Configuración al `.mobile-header`. | Alto (Navegación a 1 toque) |
| **Sprint 4** | `src/renderer/src/router.ts` | Añadir modal de confirmación reutilizable y manejo de "Atrás" por etapas en todas las vistas. | Alto |
| **Sprint 4** | `src/renderer/src/services/pdfService.ts` | Añadir soporte de "Compartir PDF" tras guardar usando Web Share API / URI de Filesystem. | Muy Alto (Valor añadido clave en móvil) |

---

### 🚀 Orden de Ejecución Recomendado
1. **Paso 1:** Aplicar **Sprint 1** (`theme.css`, `global.css`, `components.css`, `types.ts`, `compress.ts`) para estabilizar todos los estilos y reparar el modo de compresión.
2. **Paso 2:** Aplicar **Sprint 4** (`index.html`, `main.ts`, `router.ts`, `pdfService.ts`) para dejar lista la nueva navegación de 5 pestañas, el modal de confirmación y la función de compartir.
3. **Paso 3:** Aplicar **Sprint 2 y Sprint 3** (`merge.ts`, `split.ts`, `reorder.ts`, `scan.ts`) para pulir la experiencia táctil dentro de cada herramienta.