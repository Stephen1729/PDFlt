package com.stephen1729.pdflt;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePdfPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

