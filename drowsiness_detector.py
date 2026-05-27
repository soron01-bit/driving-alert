import cv2
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk
import time
import os
import sys

# Import local modules
from eye_processor import EyeProcessor
from alarm_manager import AlarmManager

# UI Color Palette (Futuristic Dark Theme)
BG_COLOR = "#0f172a"          # Slate 900
CARD_BG = "#1e293b"           # Slate 800
TEXT_COLOR = "#f8fafc"        # Slate 50
TEXT_MUTED = "#94a3b8"        # Slate 400
COLOR_GREEN = "#10b981"       # Emerald 500
COLOR_RED = "#ef4444"         # Red 500
COLOR_CYAN = "#06b6d4"        # Cyan 500
COLOR_BLUE = "#3b82f6"        # Blue 500
ACCENT_COLOR = "#1e1b4b"      # Indigo Dark

class DrowsinessDetectorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("DRIVERALERT AI - Driver Safety System")
        self.root.geometry("1150x700")
        self.root.configure(bg=BG_COLOR)
        self.root.resizable(False, False)

        # Initialize State Variables
        self.engine_state = "RUNNING"  # "RUNNING" or "STOPPED"
        self.alarm_state = "IDLE"      # "IDLE" or "TRIGGERED"
        
        self.eyes_closed_start_time = None
        self.alarm_start_time = None
        
        # Adjustable parameters (bind to Tkinter control variables)
        self.ear_threshold = tk.DoubleVar(value=0.20)
        self.drowsiness_threshold = tk.DoubleVar(value=2.5) # seconds
        self.alarm_duration = tk.DoubleVar(value=3.0)       # seconds

        # Initialize camera and processors
        self.eye_processor = EyeProcessor()
        self.alarm_manager = AlarmManager()
        self.cap = cv2.VideoCapture(0)
        self.camera_active = True

        # Build UI layout
        self.create_widgets()

        # Handle window close cleanly
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Start the video updates
        self.update_loop()

    def create_widgets(self):
        # --- Top Banner Header ---
        header_frame = tk.Frame(self.root, bg=BG_COLOR, height=70)
        header_frame.pack(fill=tk.X, padx=20, pady=10)
        header_frame.pack_propagate(False)

        title_label = tk.Label(
            header_frame, 
            text="DRIVERALERT AI", 
            font=("Segoe UI", 24, "bold"), 
            fg=COLOR_CYAN, 
            bg=BG_COLOR
        )
        title_label.pack(side=tk.LEFT, anchor=tk.CENTER)

        subtitle_label = tk.Label(
            header_frame, 
            text="•   ACTIVE DRIVER MONITORING SYSTEM & ENGINE KILL-SWITCH EMULATOR", 
            font=("Segoe UI", 10, "bold"), 
            fg=TEXT_MUTED, 
            bg=BG_COLOR
        )
        subtitle_label.pack(side=tk.LEFT, anchor=tk.CENTER, padx=15, pady=5)

        # --- Main Layout Body ---
        body_frame = tk.Frame(self.root, bg=BG_COLOR)
        body_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)

        # Left Column: Video Feed
        left_column = tk.Frame(body_frame, bg=BG_COLOR)
        left_column.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 10))

        video_card = tk.Frame(left_column, bg=CARD_BG, bd=0, highlightthickness=1, highlightbackground=COLOR_BLUE)
        video_card.pack(fill=tk.BOTH, expand=True)

        video_header = tk.Label(
            video_card, 
            text="LIVE CAMERA STREAM", 
            font=("Segoe UI", 11, "bold"), 
            fg=TEXT_COLOR, 
            bg=CARD_BG,
            anchor=tk.W
        )
        video_header.pack(fill=tk.X, padx=15, pady=10)

        self.video_label = tk.Label(video_card, bg="#0b0f19")
        self.video_label.pack(fill=tk.BOTH, expand=True, padx=15, pady=(0, 15))

        # Right Column: Controls, Engine Status, Stats
        right_column = tk.Frame(body_frame, bg=BG_COLOR, width=420)
        right_column.pack(side=tk.RIGHT, fill=tk.Y, padx=(10, 0))
        right_column.pack_propagate(False)

        # Card 1: Engine Status Ignition Dashboard
        self.create_engine_card(right_column)

        # Card 2: Metrics Dashboard (EAR meter, closed eyes timer)
        self.create_metrics_card(right_column)

        # Card 3: Calibration Settings Panel
        self.create_settings_card(right_column)

    def create_engine_card(self, parent):
        card = tk.Frame(parent, bg=CARD_BG, bd=0, highlightthickness=1, highlightbackground=COLOR_BLUE)
        card.pack(fill=tk.X, pady=(0, 15), ipady=10)

        header = tk.Label(
            card, 
            text="VEHICLE ENGINE IGNITION STATUS", 
            font=("Segoe UI", 11, "bold"), 
            fg=TEXT_COLOR, 
            bg=CARD_BG,
            anchor=tk.W
        )
        header.pack(fill=tk.X, padx=15, pady=10)

        # Frame for ignition simulation
        ignition_frame = tk.Frame(card, bg=CARD_BG)
        ignition_frame.pack(fill=tk.X, padx=15)

        # Interactive Canvas for virtual Start/Stop Button
        self.btn_canvas = tk.Canvas(ignition_frame, width=110, height=110, bg=CARD_BG, highlightthickness=0)
        self.btn_canvas.pack(side=tk.LEFT, padx=(5, 15))
        self.btn_canvas.bind("<Button-1>", self.toggle_engine_manually)
        self.draw_engine_button()

        # Engine Text Status Labels
        text_frame = tk.Frame(ignition_frame, bg=CARD_BG)
        text_frame.pack(side=tk.LEFT, fill=tk.Y, expand=True)

        self.engine_status_lbl = tk.Label(
            text_frame, 
            text="ENGINE ACTIVE", 
            font=("Segoe UI", 16, "bold"), 
            fg=COLOR_GREEN, 
            bg=CARD_BG,
            anchor=tk.W
        )
        self.engine_status_lbl.pack(fill=tk.X, pady=(15, 2))

        self.engine_desc_lbl = tk.Label(
            text_frame, 
            text="System armed. Monitoring driver eyes.", 
            font=("Segoe UI", 9), 
            fg=TEXT_MUTED, 
            bg=CARD_BG,
            anchor=tk.W,
            justify=tk.LEFT
        )
        self.engine_desc_lbl.pack(fill=tk.X)

    def draw_engine_button(self):
        """Draws a premium car ignition ring style start-stop button."""
        self.btn_canvas.delete("all")
        
        # Color schemes based on state
        glow_color = COLOR_GREEN if self.engine_state == "RUNNING" else COLOR_RED
        text_status = "START" if self.engine_state == "STOPPED" else "STOP"
        
        # Draw outer metal ring
        self.btn_canvas.create_oval(5, 5, 105, 105, outline="#475569", width=4, fill="#1e293b")
        # Draw active glowing pulse circle
        self.btn_canvas.create_oval(12, 12, 98, 98, outline=glow_color, width=2, fill="#0f172a")
        
        # Draw Engine Ignition details
        self.btn_canvas.create_text(55, 38, text="ENGINE", font=("Segoe UI", 9, "bold"), fill=TEXT_MUTED)
        self.btn_canvas.create_text(55, 55, text="START", font=("Segoe UI", 12, "bold"), fill=glow_color)
        self.btn_canvas.create_text(55, 72, text="STOP", font=("Segoe UI", 10, "bold"), fill=TEXT_MUTED if self.engine_state == "RUNNING" else COLOR_RED)

    def create_metrics_card(self, parent):
        card = tk.Frame(parent, bg=CARD_BG, bd=0, highlightthickness=1, highlightbackground=COLOR_BLUE)
        card.pack(fill=tk.X, pady=(0, 15), ipady=10)

        header = tk.Label(
            card, 
            text="REAL-TIME TELEMETRY", 
            font=("Segoe UI", 11, "bold"), 
            fg=TEXT_COLOR, 
            bg=CARD_BG,
            anchor=tk.W
        )
        header.pack(fill=tk.X, padx=15, pady=10)

        # EAR Numeric Metrics
        metrics_frame = tk.Frame(card, bg=CARD_BG)
        metrics_frame.pack(fill=tk.X, padx=15)

        # Eye Aspect Ratio readout
        ear_box = tk.Frame(metrics_frame, bg="#0f172a", bd=1, relief=tk.SOLID)
        ear_box.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.ear_val_lbl = tk.Label(
            ear_box, 
            text="0.00", 
            font=("Consolas", 22, "bold"), 
            fg=COLOR_CYAN, 
            bg="#0f172a"
        )
        self.ear_val_lbl.pack(pady=(8, 2))
        
        lbl_ear = tk.Label(
            ear_box, 
            text="EYE ASPECT RATIO (EAR)", 
            font=("Segoe UI", 7, "bold"), 
            fg=TEXT_MUTED, 
            bg="#0f172a"
        )
        lbl_ear.pack(pady=(0, 8))

        # Closed eyes timer readout
        timer_box = tk.Frame(metrics_frame, bg="#0f172a", bd=1, relief=tk.SOLID)
        timer_box.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)

        self.timer_val_lbl = tk.Label(
            timer_box, 
            text="0.0s", 
            font=("Consolas", 22, "bold"), 
            fg=TEXT_COLOR, 
            bg="#0f172a"
        )
        self.timer_val_lbl.pack(pady=(8, 2))

        lbl_timer = tk.Label(
            timer_box, 
            text="EYES CLOSED DURATION", 
            font=("Segoe UI", 7, "bold"), 
            fg=TEXT_MUTED, 
            bg="#0f172a"
        )
        lbl_timer.pack(pady=(0, 8))

        # Eye State progress / alarm warning bar
        prog_frame = tk.Frame(card, bg=CARD_BG)
        prog_frame.pack(fill=tk.X, padx=20, pady=(15, 0))

        self.prog_lbl = tk.Label(
            prog_frame, 
            text="Drowsiness Alert Timer Progression:", 
            font=("Segoe UI", 9, "bold"), 
            fg=TEXT_MUTED, 
            bg=CARD_BG,
            anchor=tk.W
        )
        self.prog_lbl.pack(fill=tk.X, pady=(0, 5))

        # Custom canvas progress bar for nice animations
        self.progress_canvas = tk.Canvas(prog_frame, height=12, bg="#0f172a", highlightthickness=0)
        self.progress_canvas.pack(fill=tk.X)
        self.draw_progress_bar(0.0)

    def draw_progress_bar(self, percentage):
        """Draws a custom visual progress bar on the canvas."""
        self.progress_canvas.delete("all")
        w = self.progress_canvas.winfo_width()
        if w <= 1:
            w = 380  # Default fallback width before window realizes layout
        
        # Draw background track
        self.progress_canvas.create_rectangle(0, 0, w, 12, fill="#0f172a", outline="")
        
        if percentage > 0.0:
            # Color gradient: green to red
            fill_color = COLOR_GREEN
            if percentage > 0.4:
                fill_color = "#f59e0b" # Orange
            if percentage > 0.8:
                fill_color = COLOR_RED
                
            fill_w = int(w * min(percentage, 1.0))
            self.progress_canvas.create_rectangle(0, 0, fill_w, 12, fill=fill_color, outline="")

    def create_settings_card(self, parent):
        card = tk.Frame(parent, bg=CARD_BG, bd=0, highlightthickness=1, highlightbackground=COLOR_BLUE)
        card.pack(fill=tk.BOTH, expand=True, ipady=10)

        header = tk.Label(
            card, 
            text="SYSTEM PARAMETER CONFIGURATION", 
            font=("Segoe UI", 11, "bold"), 
            fg=TEXT_COLOR, 
            bg=CARD_BG,
            anchor=tk.W
        )
        header.pack(fill=tk.X, padx=15, pady=10)

        # Style customization for Ttk Sliders
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("TScale", background=CARD_BG, troughcolor="#0f172a")

        # Slider 1: EAR Sensitivity
        s1_frame = tk.Frame(card, bg=CARD_BG)
        s1_frame.pack(fill=tk.X, padx=15, pady=6)
        
        s1_lbl_frame = tk.Frame(s1_frame, bg=CARD_BG)
        s1_lbl_frame.pack(fill=tk.X)
        tk.Label(s1_lbl_frame, text="Eye Close EAR Sensitivity", font=("Segoe UI", 9, "bold"), fg=TEXT_COLOR, bg=CARD_BG).pack(side=tk.LEFT)
        self.s1_val = tk.Label(s1_lbl_frame, text="0.20", font=("Consolas", 9, "bold"), fg=COLOR_CYAN, bg=CARD_BG)
        self.s1_val.pack(side=tk.RIGHT)
        
        s1_scale = ttk.Scale(
            s1_frame, 
            from_=0.15, 
            to=0.32, 
            variable=self.ear_threshold, 
            command=lambda val: self.s1_val.config(text=f"{float(val):.2f}"),
            style="TScale"
        )
        s1_scale.pack(fill=tk.X, pady=(2, 0))

        # Slider 2: Eye Close Duration Limit (Drowsiness threshold)
        s2_frame = tk.Frame(card, bg=CARD_BG)
        s2_frame.pack(fill=tk.X, padx=15, pady=6)
        
        s2_lbl_frame = tk.Frame(s2_frame, bg=CARD_BG)
        s2_lbl_frame.pack(fill=tk.X)
        tk.Label(s2_lbl_frame, text="Trigger Alarm Delay Limit (s)", font=("Segoe UI", 9, "bold"), fg=TEXT_COLOR, bg=CARD_BG).pack(side=tk.LEFT)
        self.s2_val = tk.Label(s2_lbl_frame, text="2.5s", font=("Consolas", 9, "bold"), fg=COLOR_CYAN, bg=CARD_BG)
        self.s2_val.pack(side=tk.RIGHT)

        s2_scale = ttk.Scale(
            s2_frame, 
            from_=1.0, 
            to=5.0, 
            variable=self.drowsiness_threshold, 
            command=lambda val: self.s2_val.config(text=f"{float(val):.1f}s"),
            style="TScale"
        )
        s2_scale.pack(fill=tk.X, pady=(2, 0))

        # Slider 3: Alarm Active Duration
        s3_frame = tk.Frame(card, bg=CARD_BG)
        s3_frame.pack(fill=tk.X, padx=15, pady=6)
        
        s3_lbl_frame = tk.Frame(s3_frame, bg=CARD_BG)
        s3_lbl_frame.pack(fill=tk.X)
        tk.Label(s3_lbl_frame, text="Active Siren Warning Playtime (s)", font=("Segoe UI", 9, "bold"), fg=TEXT_COLOR, bg=CARD_BG).pack(side=tk.LEFT)
        self.s3_val = tk.Label(s3_lbl_frame, text="3.0s", font=("Consolas", 9, "bold"), fg=COLOR_CYAN, bg=CARD_BG)
        self.s3_val.pack(side=tk.RIGHT)

        s3_scale = ttk.Scale(
            s3_frame, 
            from_=1.0, 
            to=5.0, 
            variable=self.alarm_duration, 
            command=lambda val: self.s3_val.config(text=f"{float(val):.1f}s"),
            style="TScale"
        )
        s3_scale.pack(fill=tk.X, pady=(2, 0))

    def toggle_engine_manually(self, event):
        """Allows toggling the engine status manually by clicking the ignition button."""
        if self.engine_state == "RUNNING":
            self.stop_engine("MANUAL SHUTDOWN")
        else:
            self.start_engine("MANUAL IGNTION")

    def start_engine(self, source="DRIVER DETECTED"):
        if self.engine_state != "RUNNING":
            self.engine_state = "RUNNING"
            self.alarm_manager.stop_alarm()
            self.alarm_state = "IDLE"
            self.alarm_start_time = None
            
            # Update UI
            self.engine_status_lbl.config(text="ENGINE ACTIVE", fg=COLOR_GREEN)
            self.engine_desc_lbl.config(text=f"Engine restarted via {source}.", fg=TEXT_MUTED)
            self.draw_engine_button()

    def stop_engine(self, reason="DROWSINESS DETECTED"):
        if self.engine_state != "STOPPED":
            self.engine_state = "STOPPED"
            
            # Update UI
            self.engine_status_lbl.config(text="ENGINE STOPPED", fg=COLOR_RED)
            if reason == "DROWSINESS DETECTED":
                self.engine_desc_lbl.config(text="Kill-switch engaged. Press START manually.", fg=COLOR_RED)
            else:
                self.engine_desc_lbl.config(text=f"Kill-switch engaged: {reason}!", fg=COLOR_RED)
            self.draw_engine_button()

    def update_loop(self):
        """Main updates loop for camera captures and safety algorithm checks."""
        if self.camera_active and self.cap.isOpened():
            ret, frame = self.cap.read()
            if ret:
                # Resize frame to standard dimensions for displaying inside GUI
                frame = cv2.resize(frame, (640, 480))
                # Flip camera frame to act like a mirror
                frame = cv2.flip(frame, 1)

                # Process landmarks and compute Eye Aspect Ratio
                processed_frame, avg_ear, face_detected = self.eye_processor.process_frame(frame)

                # Convert frame for Tkinter insertion
                img = Image.fromarray(processed_frame)
                imgtk = ImageTk.PhotoImage(image=img)
                self.video_label.imgtk = imgtk
                self.video_label.configure(image=imgtk)

                # Run Core Safety Decision Logic
                self.run_safety_logic(avg_ear, face_detected)
            else:
                self.video_label.configure(image="", text="NO CAM FEED - CHECK USB WEBCAM", fg=COLOR_RED, font=("Segoe UI", 12, "bold"))
        else:
            self.video_label.configure(image="", text="CAMERA DISABLED OR INACTIVE", fg=TEXT_MUTED, font=("Segoe UI", 12, "bold"))

        # Re-trigger update loop
        self.root.after(10, self.update_loop)

    def run_safety_logic(self, avg_ear, face_detected):
        current_time = time.time()
        
        # 1. Update EAR readouts
        if face_detected and avg_ear is not None:
            self.ear_val_lbl.config(text=f"{avg_ear:.3f}")
            
            # 2. Check if eyes are closed (below the chosen EAR threshold)
            if avg_ear < self.ear_threshold.get():
                # Driver eyes are closed!
                if self.eyes_closed_start_time is None:
                    self.eyes_closed_start_time = current_time
                
                closed_duration = current_time - self.eyes_closed_start_time
                self.timer_val_lbl.config(text=f"{closed_duration:.1f}s", fg=COLOR_RED)
                
                # Update progress timer bar percentage
                percentage = closed_duration / self.drowsiness_threshold.get()
                self.draw_progress_bar(percentage)
                
                # Check if closed duration exceeds safety limit
                if closed_duration >= self.drowsiness_threshold.get():
                    # Check if engine is running and need to kill it and alarm
                    if self.engine_state == "RUNNING" and self.alarm_state == "IDLE":
                        self.alarm_manager.play_alarm(duration=self.alarm_duration.get())
                        self.alarm_state = "TRIGGERED"
                        self.alarm_start_time = current_time
                        self.stop_engine("DROWSINESS DETECTED")
            else:
                # Driver eyes are open!
                self.eyes_closed_start_time = None
                self.timer_val_lbl.config(text="0.0s", fg=TEXT_COLOR)
                self.draw_progress_bar(0.0)
                
                # Turn off warning alarm immediately if it's currently triggered
                if self.alarm_state == "TRIGGERED":
                    self.alarm_manager.stop_alarm()
                    self.alarm_state = "IDLE"
                    self.alarm_start_time = None

        else:
            # No face detected
            self.ear_val_lbl.config(text="---", fg=TEXT_MUTED)
            self.timer_val_lbl.config(text="---", fg=TEXT_MUTED)
            self.draw_progress_bar(0.0)
            
            # Reset closed eyes timer to avoid false alarms when face disappears
            self.eyes_closed_start_time = None

        # 3. Check alarm auto-timeout
        if self.alarm_state == "TRIGGERED" and self.alarm_start_time is not None:
            played_duration = current_time - self.alarm_start_time
            if played_duration >= self.alarm_duration.get():
                # Alarm played for its configured time (e.g. 3.0s) and turns off
                self.alarm_state = "IDLE"
                self.alarm_start_time = None
                # Note: engine remains stopped until eyes are detected open again

    def on_close(self):
        """Clean cleanup of all system devices and libraries on window close."""
        self.camera_active = False
        if self.cap.isOpened():
            self.cap.release()
        self.eye_processor.close()
        self.alarm_manager.stop_alarm()
        self.root.destroy()
        sys.exit(0)

if __name__ == "__main__":
    # Workaround for DPI scaling on modern high-resolution screens
    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except:
        pass
        
    root = tk.Tk()
    app = DrowsinessDetectorApp(root)
    root.mainloop()
