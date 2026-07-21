package com.secondbrain.app;

import android.content.Intent;
import android.provider.AlarmClock;
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
            Integer delayMinutes = call.getInt("delayMinutes");
            String message = call.getString("message");

            if (delayMinutes == null) {
                call.reject("delayMinutes is required");
                return;
            }

            // Calculate target hour and minute from current time
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.add(java.util.Calendar.MINUTE, delayMinutes);
            int hour = cal.get(java.util.Calendar.HOUR_OF_DAY);
            int minute = cal.get(java.util.Calendar.MINUTE);

            Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_MESSAGE, message)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("hour", hour);
            ret.put("minute", minute);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to set system alarm: " + e.getMessage());
        }
    }
}
