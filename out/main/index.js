"use strict";
const electron = require("electron");
const path = require("path");
const promises = require("fs/promises");
const pdfLib = require("pdf-lib");
const IPC_CHANNELS = {
  OPEN_PDF: "pdf:open-file",
  OPEN_MULTIPLE_PDFS: "pdf:open-multiple-files",
  PROCESS_DROPPED_FILES: "pdf:process-dropped-files",
  READ_PDF: "pdf:read-file",
  REORDER_PAGES: "pdf:reorder-pages",
  MERGE_PDFS: "pdf:merge-pdfs",
  EXTRACT_PAGES: "pdf:extract-pages",
  SAVE_DIALOG: "dialog:save-file"
};
async function validatePdf(filePath) {
  let fileBuffer;
  try {
    fileBuffer = await promises.readFile(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Error al leer el archivo: ${message}` };
  }
  if (fileBuffer.length === 0) {
    return { valid: false, error: "El archivo está vacío." };
  }
  const header = fileBuffer.subarray(0, 5).toString("ascii");
  if (!header.startsWith("%PDF")) {
    return {
      valid: false,
      error: "El archivo no es un PDF válido (cabecera incorrecta)."
    };
  }
  try {
    const pdfDoc = await pdfLib.PDFDocument.load(fileBuffer, {
      ignoreEncryption: true
    });
    const pageCount = pdfDoc.getPageCount();
    if (pageCount === 0) {
      return { valid: false, error: "El PDF no contiene páginas." };
    }
    let isEncrypted = false;
    try {
      await pdfLib.PDFDocument.load(fileBuffer, { ignoreEncryption: false });
    } catch {
      isEncrypted = true;
    }
    return { valid: true, pageCount, isEncrypted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("encrypt") || message.includes("password")) {
      return {
        valid: false,
        error: "El PDF está protegido con contraseña. No se puede procesar.",
        isEncrypted: true
      };
    }
    return { valid: false, error: `No se pudo leer el PDF: ${message}` };
  }
}
async function validateOutputPdf(outputPath, expectedPageCount) {
  const result = await validatePdf(outputPath);
  if (!result.valid) {
    return {
      valid: false,
      error: `El archivo resultante es inválido: ${result.error}`
    };
  }
  if (result.pageCount !== expectedPageCount) {
    return {
      valid: false,
      error: `Error de verificación: se esperaban ${expectedPageCount} páginas pero el resultado tiene ${result.pageCount}.`
    };
  }
  return result;
}
async function reorderPdfPages(inputPath, newOrder, outputPath) {
  try {
    const inputValidation = await validatePdf(inputPath);
    if (!inputValidation.valid) {
      return { success: false, error: inputValidation.error };
    }
    const sourceBytes = await promises.readFile(inputPath);
    const sourcePdf = await pdfLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();
    if (newOrder.length !== totalPages) {
      return {
        success: false,
        error: `El orden tiene ${newOrder.length} elementos pero el PDF tiene ${totalPages} páginas.`
      };
    }
    const seen = /* @__PURE__ */ new Set();
    for (const index of newOrder) {
      if (index < 0 || index >= totalPages) {
        return {
          success: false,
          error: `Índice de página inválido: ${index}. Rango válido: 0–${totalPages - 1}.`
        };
      }
      if (seen.has(index)) {
        return {
          success: false,
          error: `Índice duplicado: ${index}. Cada página debe aparecer exactamente una vez.`
        };
      }
      seen.add(index);
    }
    const newPdf = await pdfLib.PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, newOrder);
    for (const page of copiedPages) {
      newPdf.addPage(page);
    }
    const newPdfBytes = await newPdf.save();
    await promises.writeFile(outputPath, newPdfBytes);
    const outputValidation = await validateOutputPdf(outputPath, totalPages);
    if (!outputValidation.valid) {
      return { success: false, error: outputValidation.error };
    }
    return {
      success: true,
      outputPath,
      pageCount: totalPages
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Error al reordenar: ${message}` };
  }
}
async function mergePdfs(filePaths, outputPath) {
  try {
    if (!filePaths || filePaths.length === 0) {
      return { success: false, error: "No files provided for merging" };
    }
    const mergedPdf = await pdfLib.PDFDocument.create();
    for (const filePath of filePaths) {
      const pdfBytes = await promises.readFile(filePath);
      const pdfDoc = await pdfLib.PDFDocument.load(pdfBytes);
      const pageIndices = pdfDoc.getPageIndices();
      const copiedPages = await mergedPdf.copyPages(pdfDoc, pageIndices);
      for (const page of copiedPages) {
        mergedPdf.addPage(page);
      }
    }
    const mergedPdfBytes = await mergedPdf.save();
    await promises.writeFile(outputPath, mergedPdfBytes);
    return {
      success: true,
      outputPath,
      pageCount: mergedPdf.getPageCount()
    };
  } catch (error) {
    console.error("Error merging PDFs:", error);
    return {
      success: false,
      error: error.message || "Unknown error occurred while merging PDFs"
    };
  }
}
async function extractPages(filePath, selectedIndices, outputPath) {
  try {
    if (!selectedIndices || selectedIndices.length === 0) {
      return { success: false, error: "No pages selected for extraction" };
    }
    const pdfBytes = await promises.readFile(filePath);
    const originalPdf = await pdfLib.PDFDocument.load(pdfBytes);
    const newPdf = await pdfLib.PDFDocument.create();
    const copiedPages = await newPdf.copyPages(originalPdf, selectedIndices);
    for (const page of copiedPages) {
      newPdf.addPage(page);
    }
    const newPdfBytes = await newPdf.save();
    await promises.writeFile(outputPath, newPdfBytes);
    return {
      success: true,
      outputPath,
      pageCount: newPdf.getPageCount()
    };
  } catch (error) {
    console.error("Error extracting pages:", error);
    return {
      success: false,
      error: error.message || "Unknown error occurred while extracting pages"
    };
  }
}
function registerIpcHandlers() {
  electron.ipcMain.handle(IPC_CHANNELS.OPEN_PDF, async () => {
    const window = electron.BrowserWindow.getFocusedWindow();
    if (!window) return null;
    const result = await electron.dialog.showOpenDialog(window, {
      title: "Seleccionar PDF",
      filters: [{ name: "Archivos PDF", extensions: ["pdf"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const validation = await validatePdf(filePath);
    if (!validation.valid) {
      electron.dialog.showErrorBox("PDF inválido", validation.error || "No se pudo leer el archivo.");
      return null;
    }
    const fileStats = await promises.stat(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      pageCount: validation.pageCount,
      fileSizeBytes: fileStats.size,
      isEncrypted: validation.isEncrypted || false
    };
  });
  electron.ipcMain.handle(IPC_CHANNELS.READ_PDF, async (_event, filePath) => {
    const buffer = await promises.readFile(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.REORDER_PAGES,
    async (_event, filePath, newOrder) => {
      const window = electron.BrowserWindow.getFocusedWindow();
      if (!window) return { success: false, error: "No hay ventana activa" };
      const saveResult = await electron.dialog.showSaveDialog(window, {
        title: "Guardar PDF reordenado",
        defaultPath: filePath.replace(/\.pdf$/i, "_reordenado.pdf"),
        filters: [{ name: "Archivos PDF", extensions: ["pdf"] }]
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: "Operación cancelada" };
      }
      return reorderPdfPages(filePath, newOrder, saveResult.filePath);
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.SAVE_DIALOG,
    async (_event, defaultName) => {
      const window = electron.BrowserWindow.getFocusedWindow();
      if (!window) return null;
      const result = await electron.dialog.showSaveDialog(window, {
        title: "Guardar archivo",
        defaultPath: defaultName,
        filters: [{ name: "Archivos PDF", extensions: ["pdf"] }]
      });
      return result.canceled ? null : result.filePath || null;
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.OPEN_MULTIPLE_PDFS, async () => {
    const window = electron.BrowserWindow.getFocusedWindow();
    if (!window) return null;
    const result = await electron.dialog.showOpenDialog(window, {
      title: "Seleccionar PDFs",
      filters: [{ name: "Archivos PDF", extensions: ["pdf"] }],
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filesInfo = [];
    for (const filePath of result.filePaths) {
      const validation = await validatePdf(filePath);
      if (!validation.valid) {
        electron.dialog.showErrorBox("PDF inválido", `El archivo ${path.basename(filePath)} no se pudo leer.`);
        continue;
      }
      const fileStats = await promises.stat(filePath);
      filesInfo.push({
        filePath,
        fileName: path.basename(filePath),
        pageCount: validation.pageCount,
        fileSizeBytes: fileStats.size,
        isEncrypted: validation.isEncrypted || false
      });
    }
    return filesInfo.length > 0 ? filesInfo : null;
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.PROCESS_DROPPED_FILES,
    async (_event, filePaths) => {
      const filesInfo = [];
      for (const filePath of filePaths) {
        const validation = await validatePdf(filePath);
        if (!validation.valid) {
          electron.dialog.showErrorBox("PDF inválido", `El archivo ${path.basename(filePath)} no se pudo leer.`);
          continue;
        }
        const fileStats = await promises.stat(filePath);
        filesInfo.push({
          filePath,
          fileName: path.basename(filePath),
          pageCount: validation.pageCount,
          fileSizeBytes: fileStats.size,
          isEncrypted: validation.isEncrypted || false
        });
      }
      return filesInfo;
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.MERGE_PDFS,
    async (_event, filePaths) => {
      const window = electron.BrowserWindow.getFocusedWindow();
      if (!window) return { success: false, error: "No hay ventana activa" };
      const saveResult = await electron.dialog.showSaveDialog(window, {
        title: "Guardar PDF unido",
        defaultPath: "pdf_unido.pdf",
        filters: [{ name: "Archivos PDF", extensions: ["pdf"] }]
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: "Operación cancelada" };
      }
      return mergePdfs(filePaths, saveResult.filePath);
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.EXTRACT_PAGES,
    async (_event, filePath, selectedIndices) => {
      const window = electron.BrowserWindow.getFocusedWindow();
      if (!window) return { success: false, error: "No hay ventana activa" };
      const saveResult = await electron.dialog.showSaveDialog(window, {
        title: "Guardar PDF extraído",
        defaultPath: filePath.replace(/\.pdf$/i, "_extraido.pdf"),
        filters: [{ name: "Archivos PDF", extensions: ["pdf"] }]
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: "Operación cancelada" };
      }
      const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
      return extractPages(filePath, sortedIndices, saveResult.filePath);
    }
  );
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: "PDFToolkit",
    backgroundColor: "#0f0f1a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  electron.Menu.setApplicationMenu(null);
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
