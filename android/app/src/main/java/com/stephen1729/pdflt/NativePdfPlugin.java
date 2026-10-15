package com.stephen1729.pdflt;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.UUID;

@CapacitorPlugin(name = "NativePdf")
public class NativePdfPlugin extends Plugin {

    private ParcelFileDescriptor openDescriptor(String path) throws Exception {
        if (path.startsWith("content://")) {
            return getContext().getContentResolver().openFileDescriptor(Uri.parse(path), "r");
        }
        String cleanPath = path.startsWith("file://") ? path.substring(7) : path;
        return ParcelFileDescriptor.open(new File(cleanPath), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @PluginMethod
    public void renderThumbnail(PluginCall call) {
        String path = call.getString("path");
        int pageIndex = call.getInt("pageIndex", 0);
        int width = call.getInt("width", 320);

        if (path == null || path.isEmpty()) {
            call.reject("Path is required");
            return;
        }

        ParcelFileDescriptor pfd = null;
        PdfRenderer renderer = null;
        PdfRenderer.Page page = null;
        Bitmap bitmap = null;
        FileOutputStream fos = null;

        try {
            pfd = openDescriptor(path);
            if (pfd == null) {
                call.reject("Could not open file descriptor for: " + path);
                return;
            }

            renderer = new PdfRenderer(pfd);
            if (pageIndex < 0 || pageIndex >= renderer.getPageCount()) {
                call.reject("Page index out of bounds: " + pageIndex + ", total: " + renderer.getPageCount());
                return;
            }

            page = renderer.openPage(pageIndex);
            int origW = page.getWidth();
            int origH = page.getHeight();
            int targetW = width > 0 ? width : 320;
            int targetH = (int) Math.round(((double) origH * targetW) / (double) origW);

            bitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.WHITE);
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

            File cacheDir = getContext().getCacheDir();
            File outFile = new File(cacheDir, "thumb_" + UUID.randomUUID().toString() + ".jpg");
            fos = new FileOutputStream(outFile);
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, fos);
            fos.flush();

            JSObject ret = new JSObject();
            ret.put("path", outFile.getAbsolutePath());
            ret.put("width", targetW);
            ret.put("height", targetH);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Native thumbnail render failed: " + e.getMessage(), e);
        } finally {
            if (page != null) {
                try { page.close(); } catch (Exception ignored) {}
            }
            if (renderer != null) {
                try { renderer.close(); } catch (Exception ignored) {}
            }
            if (pfd != null) {
                try { pfd.close(); } catch (Exception ignored) {}
            }
            if (fos != null) {
                try { fos.close(); } catch (Exception ignored) {}
            }
            if (bitmap != null) {
                bitmap.recycle();
            }
        }
    }

    @PluginMethod
    public void renderPageForCompression(PluginCall call) {
        String path = call.getString("path");
        int pageIndex = call.getInt("pageIndex", 0);
        Double scale = call.getDouble("scale", 1.5);
        int quality = call.getInt("quality", 80);

        if (path == null || path.isEmpty()) {
            call.reject("Path is required");
            return;
        }

        ParcelFileDescriptor pfd = null;
        PdfRenderer renderer = null;
        PdfRenderer.Page page = null;
        Bitmap bitmap = null;
        FileOutputStream fos = null;

        try {
            pfd = openDescriptor(path);
            if (pfd == null) {
                call.reject("Could not open file descriptor for: " + path);
                return;
            }

            renderer = new PdfRenderer(pfd);
            if (pageIndex < 0 || pageIndex >= renderer.getPageCount()) {
                call.reject("Page index out of bounds: " + pageIndex);
                return;
            }

            page = renderer.openPage(pageIndex);
            int origW = page.getWidth();
            int origH = page.getHeight();
            double finalScale = scale != null && scale > 0 ? scale : 1.5;
            int targetW = (int) Math.round(origW * finalScale);
            int targetH = (int) Math.round(origH * finalScale);

            bitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.WHITE);
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);

            File cacheDir = getContext().getCacheDir();
            File outFile = new File(cacheDir, "page_" + UUID.randomUUID().toString() + ".jpg");
            fos = new FileOutputStream(outFile);
            int validQuality = Math.max(1, Math.min(100, quality));
            bitmap.compress(Bitmap.CompressFormat.JPEG, validQuality, fos);
            fos.flush();

            JSObject ret = new JSObject();
            ret.put("path", outFile.getAbsolutePath());
            ret.put("width", targetW);
            ret.put("height", targetH);
            ret.put("originalWidth", origW);
            ret.put("originalHeight", origH);
            ret.put("size", outFile.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Native page render failed: " + e.getMessage(), e);
        } finally {
            if (page != null) {
                try { page.close(); } catch (Exception ignored) {}
            }
            if (renderer != null) {
                try { renderer.close(); } catch (Exception ignored) {}
            }
            if (pfd != null) {
                try { pfd.close(); } catch (Exception ignored) {}
            }
            if (fos != null) {
                try { fos.close(); } catch (Exception ignored) {}
            }
            if (bitmap != null) {
                bitmap.recycle();
            }
        }
    }

    @PluginMethod
    public void getPageCount(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Path is required");
            return;
        }
        ParcelFileDescriptor pfd = null;
        PdfRenderer renderer = null;
        try {
            pfd = openDescriptor(path);
            if (pfd == null) {
                call.reject("Could not open file descriptor for: " + path);
                return;
            }
            renderer = new PdfRenderer(pfd);
            int count = renderer.getPageCount();

            JSObject ret = new JSObject();
            ret.put("pageCount", count);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not get page count: " + e.getMessage(), e);
        } finally {
            if (renderer != null) {
                try { renderer.close(); } catch (Exception ignored) {}
            }
            if (pfd != null) {
                try { pfd.close(); } catch (Exception ignored) {}
            }
        }
    }

    @PluginMethod
    public void compressImage(PluginCall call) {
        String path = call.getString("path");
        int quality = call.getInt("quality", 80);
        int maxWidth = call.getInt("maxWidth", 1800);
        int maxHeight = call.getInt("maxHeight", 1800);

        if (path == null || path.isEmpty()) {
            call.reject("Path is required");
            return;
        }

        Bitmap bitmap = null;
        FileOutputStream fos = null;

        try {
            String cleanPath = path.startsWith("file://") ? path.substring(7) : path;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;

            if (path.startsWith("content://")) {
                InputStream is = getContext().getContentResolver().openInputStream(Uri.parse(path));
                BitmapFactory.decodeStream(is, null, opts);
                if (is != null) is.close();
            } else {
                BitmapFactory.decodeFile(cleanPath, opts);
            }

            int w = opts.outWidth;
            int h = opts.outHeight;
            int sampleSize = 1;
            while ((maxWidth > 0 && w / (sampleSize * 2) >= maxWidth) || (maxHeight > 0 && h / (sampleSize * 2) >= maxHeight)) {
                sampleSize *= 2;
            }

            opts.inJustDecodeBounds = false;
            opts.inSampleSize = sampleSize;

            if (path.startsWith("content://")) {
                InputStream is = getContext().getContentResolver().openInputStream(Uri.parse(path));
                bitmap = BitmapFactory.decodeStream(is, null, opts);
                if (is != null) is.close();
            } else {
                bitmap = BitmapFactory.decodeFile(cleanPath, opts);
            }

            if (bitmap == null) {
                call.reject("Could not decode image from: " + path);
                return;
            }

            File cacheDir = getContext().getCacheDir();
            File outFile = new File(cacheDir, "comp_" + UUID.randomUUID().toString() + ".jpg");
            fos = new FileOutputStream(outFile);
            int validQuality = Math.max(1, Math.min(100, quality));
            bitmap.compress(Bitmap.CompressFormat.JPEG, validQuality, fos);
            fos.flush();

            int finalW = bitmap.getWidth();
            int finalH = bitmap.getHeight();

            JSObject ret = new JSObject();
            ret.put("path", outFile.getAbsolutePath());
            ret.put("size", outFile.length());
            ret.put("width", finalW);
            ret.put("height", finalH);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Image compression failed: " + e.getMessage(), e);
        } finally {
            if (fos != null) {
                try { fos.close(); } catch (Exception ignored) {}
            }
            if (bitmap != null) {
                bitmap.recycle();
            }
        }
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        try {
            File cacheDir = getContext().getCacheDir();
            if (cacheDir != null && cacheDir.exists()) {
                File[] files = cacheDir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        String name = f.getName();
                        if (name.startsWith("thumb_") || name.startsWith("page_") || name.startsWith("comp_")) {
                            f.delete();
                        }
                    }
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Clear cache failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openPdf(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Path is required");
            return;
        }

        try {
            Uri contentUri;
            if (path.startsWith("content://")) {
                contentUri = Uri.parse(path);
            } else {
                String cleanPath = path.startsWith("file://") ? path.substring(7) : path;
                File file = new File(cleanPath);
                if (!file.exists()) {
                    call.reject("File does not exist: " + cleanPath);
                    return;
                }
                contentUri = androidx.core.content.FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );
            }

            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/pdf");
            intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);

            android.content.Intent chooser = android.content.Intent.createChooser(intent, "Abrir PDF");
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open PDF: " + e.getMessage(), e);
        }
    }
}

