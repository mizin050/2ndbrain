package com.secondbrain.app;

import android.content.Intent;
import android.provider.AlarmClock;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SystemAlarm")
public class SystemAlarmPlugin extends Plugin {

    @PluginMethod
    public void setAlarm(PluginCall call) {
        try {
            // Retrieve delayMinutes safely
            Integer delayMinutes = null;
            try {
                delayMinutes = call.getInt("delayMinutes");
            } catch (Exception e) {
                // Try converting from float/double if passed as decimal number from JS
                Double dVal = call.getDouble("delayMinutes");
                if (dVal != null) {
                    delayMinutes = (int) Math.round(dVal);
                }
            }

            final String message = call.getString("message") != null ? call.getString("message") : "Second Brain Alert";

            if (delayMinutes == null) {
                final String errMsg = "Error: delayMinutes parameter is null or invalid!";
                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(getContext(), errMsg, Toast.LENGTH_LONG).show();
                    }
                });
                call.reject(errMsg);
                return;
            }

            final int finalDelay = delayMinutes;

            // Calculate target hour and minute from current time
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.add(java.util.Calendar.MINUTE, finalDelay);
            final int hour = cal.get(java.util.Calendar.HOUR_OF_DAY);
            final int minute = cal.get(java.util.Calendar.MINUTE);

            // Display a diagnostic native system Toast to prove Java code execution
            getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(getContext(), "🧠 [Second Brain] Setting native alarm for " + hour + ":" + String.format("%02d", minute) + " (" + finalDelay + " min delay)", Toast.LENGTH_LONG).show();
                }
            });

            Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_MESSAGE, message)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (intent.resolveActivity(getContext().getPackageManager()) != null) {
                getContext().startActivity(intent);
                
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("hour", hour);
                ret.put("minute", minute);
                call.resolve(ret);
            } else {
                // If skip UI failed or system clock package is restricted, try opening the alarm clock without skip UI
                final String warnMsg = "Warn: resolveActivity failed with EXTRA_SKIP_UI, attempting standard launch...";
                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(getContext(), warnMsg, Toast.LENGTH_LONG).show();
                    }
                });

                Intent fallbackIntent = new Intent(AlarmClock.ACTION_SET_ALARM)
                    .putExtra(AlarmClock.EXTRA_HOUR, hour)
                    .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                    .putExtra(AlarmClock.EXTRA_MESSAGE, message)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                getContext().startActivity(fallbackIntent);

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("fallback", true);
                call.resolve(ret);
            }

        } catch (final Exception e) {
            getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(getContext(), "❌ SystemAlarm Error: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
            call.reject("Failed to set system alarm: " + e.getMessage());
        }
    }
}
