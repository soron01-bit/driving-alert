import numpy as np
import sounddevice as sd
import threading
import time

class AlarmManager:
    def __init__(self, sample_rate=44100):
        self.sample_rate = sample_rate
        self.playing = False
        self.thread = None
        self._stop_event = threading.Event()

    def _generate_pulse_tone(self, duration, freq=1200, pulse_on=0.15, pulse_off=0.1):
        """Generate a numpy array representing pulsing beep tones."""
        t = np.arange(0, duration, 1.0 / self.sample_rate)
        
        # Determine for each time sample if the beep is "on" or "off"
        cycle_len = pulse_on + pulse_off
        cycle_time = t % cycle_len
        pulse_mask = cycle_time < pulse_on
        
        # Generate sine wave and apply mask
        sine_wave = np.sin(2 * np.pi * freq * t)
        audio_data = sine_wave * pulse_mask
        
        # Make the sound loud and stereo-like (dual channel) if needed, 
        # or simple mono which sounddevice handles automatically
        return audio_data.astype(np.float32)

    def play_alarm(self, duration=3.0):
        """Play the alarm asynchronously for the given duration."""
        if self.playing:
            return  # Already playing
        
        self.playing = True
        self._stop_event.clear()
        
        # Start playback in a separate thread to control duration and stop events easily
        self.thread = threading.Thread(target=self._run_alarm, args=(duration,), daemon=True)
        self.thread.start()

    def _run_alarm(self, duration):
        try:
            # Generate the alarm audio data (1200Hz pulsing sound)
            audio_data = self._generate_pulse_tone(duration, freq=1200, pulse_on=0.12, pulse_off=0.08)
            
            # Start playing using sounddevice (non-blocking)
            sd.play(audio_data, self.sample_rate)
            
            # Wait for duration or stop event
            start_time = time.time()
            while time.time() - start_time < duration:
                if self._stop_event.is_set():
                    sd.stop()
                    break
                time.sleep(0.02)
            
            # Ensure playback stops
            sd.stop()
        except Exception as e:
            print(f"Sounddevice playback error: {e}. Falling back to winsound.")
            # Fallback to winsound (Windows-only beep) as safety measure
            try:
                import winsound
                # Play a sequence of beeps
                start_time = time.time()
                while time.time() - start_time < duration:
                    if self._stop_event.is_set():
                        break
                    winsound.Beep(1200, 150)
                    time.sleep(0.05)
            except Exception as ex:
                print(f"Winsound fallback failed: {ex}")
        finally:
            self.playing = False

    def stop_alarm(self):
        """Immediately stop the alarm playback."""
        if self.playing:
            self._stop_event.set()
            if self.thread:
                self.thread.join(timeout=0.5)
            self.playing = False
