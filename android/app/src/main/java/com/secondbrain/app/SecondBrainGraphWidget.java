package com.secondbrain.app;

import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;
import android.widget.RemoteViews;
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
                    // Update every 1.5 seconds for fluid but battery-friendly drift!
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

        // 1. Draw subtle sci-fi grid dots
        Paint gridPaint = new Paint();
        gridPaint.setColor(Color.parseColor("#222222"));
        gridPaint.setStyle(Paint.Style.FILL);
        for (int i = 40; i < CANVAS_SIZE; i += 40) {
            for (int j = 40; j < CANVAS_SIZE; j += 40) {
                canvas.drawCircle(i, j, 2f, gridPaint);
            }
        }

        // 2. Define node positions dynamically with sine/cosine orbital drifts
        String[] labels = {"KASU", "COLLEGE", "NEURAL QUEUE", "ALARM", "VOICE", "MEMORY", "WORK", "IDEAS"};
        float[][] nodes = new float[labels.length][2];
        
        float centerX = CANVAS_SIZE / 2f;
        float centerY = CANVAS_SIZE / 2f;
        float radius = 100f;

        for (int i = 0; i < labels.length; i++) {
            // Distribute base coordinates evenly in a circle
            double angle = (2 * Math.PI * i) / labels.length;
            float baseX = centerX + (float) (Math.cos(angle) * radius);
            float baseY = centerY + (float) (Math.sin(angle) * radius);

            // Add smooth, overlapping sine-wave drifts based on system time
            float driftX = (float) Math.sin((time * 0.0008) + (i * 1.5)) * 25f;
            float driftY = (float) Math.cos((time * 0.0006) + (i * 2.1)) * 25f;

            nodes[i][0] = baseX + driftX;
            nodes[i][1] = baseY + driftY;
        }

        // 3. Draw connecting lines between close neighbors
        Paint linePaint = new Paint();
        linePaint.setColor(Color.parseColor("#33FF5E00")); // semi-translucent orange
        linePaint.setStrokeWidth(1.5f);
        linePaint.setAntiAlias(true);

        for (int i = 0; i < nodes.length; i++) {
            for (int j = i + 1; j < nodes.length; j++) {
                float dx = nodes[i][0] - nodes[j][0];
                float dy = nodes[i][1] - nodes[j][1];
                float dist = (float) Math.sqrt(dx * dx + dy * dy);

                // If close enough, draw a glowing constellation bridge
                if (dist < 150f) {
                    float alphaRatio = 1.0f - (dist / 150f);
                    linePaint.setAlpha((int) (alphaRatio * 80));
                    canvas.drawLine(nodes[i][0], nodes[i][1], nodes[j][0], nodes[j][1], linePaint);
                }
            }
        }

        // 4. Draw glowing nodes & text labels
        Paint nodePaint = new Paint();
        nodePaint.setAntiAlias(true);
        nodePaint.setStyle(Paint.Style.FILL);

        Paint textPaint = new Paint();
        textPaint.setColor(Color.parseColor("#CCCCCC"));
        textPaint.setTextSize(10f);
        textPaint.setAntiAlias(true);
        textPaint.setStyle(Paint.Style.FILL);
        textPaint.setTextAlign(Paint.Align.CENTER);

        for (int i = 0; i < nodes.length; i++) {
            // Draw dual concentric glowing layers
            nodePaint.setColor(Color.parseColor("#22FF5E00")); // glow
            canvas.drawCircle(nodes[i][0], nodes[i][1], 8f, nodePaint);

            nodePaint.setColor(Color.parseColor("#FF5E00")); // core
            canvas.drawCircle(nodes[i][0], nodes[i][1], 3.5f, nodePaint);

            // Text Label with custom backdrop offset
            canvas.drawText(labels[i], nodes[i][0], nodes[i][1] - 12f, textPaint);
        }

        views.setImageViewBitmap(R.id.graph_image, bitmap);
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
