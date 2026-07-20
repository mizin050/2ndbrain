package com.secondbrain.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;
import android.widget.RemoteViews;
import org.json.JSONArray;
import java.util.ArrayList;

public class SecondBrainGraphWidget extends AppWidgetProvider {

    private static final int CANVAS_SIZE = 400;
    private static Handler animationHandler;
    private static Runnable animationRunnable;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateGraphWidget(context, appWidgetManager, appWidgetId);
        }
        startAnimationLoop(context);
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        startAnimationLoop(context);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        stopAnimationLoop();
    }

    private static void startAnimationLoop(final Context context) {
        if (animationHandler == null) {
            animationHandler = new Handler(Looper.getMainLooper());
        }
        if (animationRunnable == null) {
            animationRunnable = new Runnable() {
                @Override
                public void run() {
                    Context appContext = context.getApplicationContext();
                    AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(appContext);
                    int[] appWidgetIds = appWidgetManager.getAppWidgetIds(new ComponentName(appContext, SecondBrainGraphWidget.class));
                    
                    for (int appWidgetId : appWidgetIds) {
                        updateGraphWidget(appContext, appWidgetManager, appWidgetId);
                    }
                    animationHandler.postDelayed(this, 1500);
                }
            };
            animationHandler.postDelayed(animationRunnable, 1500);
        }
    }

    private static void stopAnimationLoop() {
        if (animationHandler != null && animationRunnable != null) {
            animationHandler.removeCallbacks(animationRunnable);
            animationRunnable = null;
        }
    }

    static void updateGraphWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.second_brain_graph_widget);

        // Draw the dynamic floating constellation bitmap
        Bitmap bitmap = Bitmap.createBitmap(CANVAS_SIZE, CANVAS_SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        
        long time = System.currentTimeMillis();

        // 1. Draw subtle sci-fi grid dots (with high transparency)
        Paint gridPaint = new Paint();
        gridPaint.setColor(Color.parseColor("#0FFF5E00"));
        gridPaint.setStyle(Paint.Style.FILL);
        for (int i = 30; i < CANVAS_SIZE; i += 45) {
            for (int j = 30; j < CANVAS_SIZE; j += 45) {
                canvas.drawCircle(i, j, 1.2f, gridPaint);
            }
        }

        // 2. Read synced actual nodes list from SharedPreferences
        SharedPreferences sharedPref = context.getSharedPreferences("SecondBrainWidget", Context.MODE_PRIVATE);
        String nodesJson = sharedPref.getString("nodes", "[]");
        
        ArrayList<String> labelsList = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(nodesJson);
            for (int i = 0; i < arr.length(); i++) {
                labelsList.add(arr.getString(i));
            }
        } catch (Exception e) {
            // handle error silently
        }

        // Default nodes if none are synced yet
        if (labelsList.isEmpty()) {
            labelsList.add("KASU");
            labelsList.add("COLLEGE");
            labelsList.add("QUEUE");
            labelsList.add("ALARM");
            labelsList.add("VOICE");
            labelsList.add("MEMORY");
            labelsList.add("WORK");
            labelsList.add("IDEAS");
        }

        int count = labelsList.size();
        float[][] nodes = new float[count][2];
        
        float centerX = CANVAS_SIZE / 2f;
        float centerY = CANVAS_SIZE / 2f;
        
        // Compact radius to ensure 100% visibility (no boundary clipping!)
        float orbitRadius = 80f;

        for (int i = 0; i < count; i++) {
            double angle = (2 * Math.PI * i) / count;
            float baseX = centerX + (float) (Math.cos(angle) * orbitRadius);
            float baseY = centerY + (float) (Math.sin(angle) * orbitRadius);

            // Floating wave-like movements (kept inside safe bounds)
            float driftX = (float) Math.sin((time * 0.0008) + (i * 1.5)) * 18f;
            float driftY = (float) Math.cos((time * 0.0006) + (i * 2.1)) * 18f;

            nodes[i][0] = baseX + driftX;
            nodes[i][1] = baseY + driftY;
        }

        // 3. Draw core connections (lines from central core "YOU" to satellites)
        Paint coreLinePaint = new Paint();
        coreLinePaint.setColor(Color.parseColor("#20FF5E00"));
        coreLinePaint.setStrokeWidth(1.5f);
        coreLinePaint.setAntiAlias(true);
        for (int i = 0; i < count; i++) {
            canvas.drawLine(centerX, centerY, nodes[i][0], nodes[i][1], coreLinePaint);
        }

        // 4. Draw satellite-to-satellite connecting lines (for inter-node similarity!)
        Paint linePaint = new Paint();
        linePaint.setColor(Color.parseColor("#15FF5E00"));
        linePaint.setStrokeWidth(1.2f);
        linePaint.setAntiAlias(true);

        for (int i = 0; i < count; i++) {
            for (int j = i + 1; j < count; j++) {
                float dx = nodes[i][0] - nodes[j][0];
                float dy = nodes[i][1] - nodes[j][1];
                float dist = (float) Math.sqrt(dx * dx + dy * dy);

                if (dist < 110f) {
                    float alphaRatio = 1.0f - (dist / 110f);
                    linePaint.setAlpha((int) (alphaRatio * 70));
                    canvas.drawLine(nodes[i][0], nodes[i][1], nodes[j][0], nodes[j][1], linePaint);
                }
            }
        }

        // 5. Draw glowing satellite nodes & actual synced labels
        Paint nodePaint = new Paint();
        nodePaint.setAntiAlias(true);
        nodePaint.setStyle(Paint.Style.FILL);

        Paint textPaint = new Paint();
        textPaint.setColor(Color.parseColor("#FFAA66")); // Warm highly legible label color
        textPaint.setTextSize(9f);
        textPaint.setAntiAlias(true);
        textPaint.setStyle(Paint.Style.FILL);
        textPaint.setTextAlign(Paint.Align.CENTER);

        for (int i = 0; i < count; i++) {
            nodePaint.setColor(Color.parseColor("#22FF5E00")); // glow ring
            canvas.drawCircle(nodes[i][0], nodes[i][1], 9f, nodePaint);

            nodePaint.setColor(Color.parseColor("#FF5E00")); // core dot
            canvas.drawCircle(nodes[i][0], nodes[i][1], 3.5f, nodePaint);

            // Render actual node labels directly in space next to the nodes
            canvas.drawText(labelsList.get(i), nodes[i][0], nodes[i][1] - 9f, textPaint);
        }

        // 6. Draw central CORE Node ("YOU" / "2ND BRAIN" just like in-app!)
        nodePaint.setColor(Color.parseColor("#40FF5E00")); // Glowing core halo
        canvas.drawCircle(centerX, centerY, 18f, nodePaint);
        
        nodePaint.setColor(Color.parseColor("#FF5E00")); // Solid core dot
        canvas.drawCircle(centerX, centerY, 7f, nodePaint);

        Paint coreTextPaint = new Paint();
        coreTextPaint.setColor(Color.parseColor("#FFFFFF"));
        coreTextPaint.setTextSize(8f);
        coreTextPaint.setFakeBoldText(true);
        coreTextPaint.setAntiAlias(true);
        coreTextPaint.setTextAlign(Paint.Align.CENTER);
        // Center text perfectly inside the core node
        canvas.drawText("YOU", centerX, centerY + 3.2f, coreTextPaint);

        views.setImageViewBitmap(R.id.graph_image, bitmap);

        // 7. Normal launch intent to open the main app like standard tapping
        Intent clickIntent = new Intent(context, MainActivity.class);
        clickIntent.setAction(Intent.ACTION_MAIN);
        clickIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        clickIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        views.setOnClickPendingIntent(R.id.graph_image, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
