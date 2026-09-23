package de.crumb.companion

import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.SystemClock
import android.view.ContextThemeWrapper
import android.view.View
import android.widget.Chronometer
import android.widget.FrameLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DeviceTimerLayoutTest {
    @Test fun rendersCompactAndExpandedTimersAtNormalAndLargeFontSizes() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext
        val folder = File(app.getExternalFilesDir(null), "timer-layouts").apply { mkdirs() }
        instrumentation.runOnMainSync {
            for (night in listOf(false, true)) for (fontScale in listOf(1f, 1.3f)) for (hours in listOf(false, true)) {
                val config = Configuration(app.resources.configuration).apply {
                    uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                        (if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
                    this.fontScale = fontScale
                }
                val context = ContextThemeWrapper(app.createConfigurationContext(config),
                    if (night) android.R.style.Theme_Material_NoActionBar else android.R.style.Theme_Material_Light_NoActionBar)
                val now = System.currentTimeMillis()
                val remaining = if (hours) 7_449_000L else 1_449_000L
                val step = Step("1:0", 0, "Stockgare", "30 Minuten ruhen lassen, dann dehnen und falten.", "active",
                    now - 351_000, now + remaining, now + remaining, false, "complete", "render-only")
                val notice = timerNotification(context, Task(Session(1, 0, "Einfaches Weizenbrot", listOf(step)), step), now)
                for ((expanded, remote) in listOf(false to notice.contentView, true to notice.bigContentView)) {
                    val view = remote.apply(context, FrameLayout(context))
                    val density = context.resources.displayMetrics.density
                    val width = (300 * density).toInt()
                    val holder = FrameLayout(context).apply { addView(view) }
                    holder.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec((252 * density).toInt(), View.MeasureSpec.AT_MOST))
                    holder.layout(0, 0, holder.measuredWidth, holder.measuredHeight)
                    val clock = view.findViewById<Chronometer>(R.id.timer_clock)
                    val diagnostic = "night=$night scale=$fontScale hours=$hours expanded=$expanded text=${clock.text} size=${clock.textSize} color=${clock.currentTextColor} width=${clock.width} height=${clock.height} visibility=${clock.visibility}"
                    File(folder, "diagnostics.txt").appendText(diagnostic + "\n")
                    assertTrue(diagnostic, clock.text.isNotBlank())
                    assertTrue(clock.isCountDown)
                    assertTrue(clock.base > SystemClock.elapsedRealtime())
                    assertTrue("Clock text must fit its assigned width", clock.paint.measureText(clock.text.toString()) <= clock.width)
                    assertTrue("Clock text must fit its assigned height", clock.paint.fontMetrics.let { it.descent - it.ascent } <= clock.height)
                    assertTrue(diagnostic, view.measuredHeight <= kotlin.math.ceil((if (expanded) 252 else 48) * density))
                    val bitmap = Bitmap.createBitmap(view.measuredWidth, view.measuredHeight, Bitmap.Config.ARGB_8888)
                    val canvas = Canvas(bitmap)
                    canvas.drawColor(if (night) Color.rgb(29, 32, 38) else Color.rgb(250, 249, 246))
                    view.draw(canvas)
                    val name = "${if (night) "dark" else "light"}-${fontScale}-${if (hours) "hours" else "minutes"}-${if (expanded) "expanded" else "compact"}.png"
                    File(folder, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                }
            }
        }
    }
}
