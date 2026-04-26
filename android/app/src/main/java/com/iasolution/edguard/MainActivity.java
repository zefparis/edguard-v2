package com.iasolution.edguard;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int PERMISSIONS_REQUEST_CODE = 1001;

    private static final String[] REQUIRED_PERMISSIONS = new String[] {
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.CAMERA
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestRuntimePermissionsIfNeeded();
    }

    private void requestRuntimePermissionsIfNeeded() {
        boolean missing = false;
        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission)
                    != PackageManager.PERMISSION_GRANTED) {
                missing = true;
                break;
            }
        }
        if (missing) {
            ActivityCompat.requestPermissions(
                this,
                REQUIRED_PERMISSIONS,
                PERMISSIONS_REQUEST_CODE
            );
        }
    }
}
