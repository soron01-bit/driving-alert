import cv2
import numpy as np
import os
import urllib.request
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python import BaseOptions

class EyeProcessor:
    # MediaPipe Face Mesh landmark indices for Eye Aspect Ratio (EAR) calculation
    # Right eye indices (coordinates from subject's perspective)
    RIGHT_EYE_P1 = 33   # Inner corner
    RIGHT_EYE_P2 = 160  # Top-left (upper eyelid)
    RIGHT_EYE_P3 = 158  # Top-right (upper eyelid)
    RIGHT_EYE_P4 = 133  # Outer corner
    RIGHT_EYE_P5 = 153  # Bottom-right (lower eyelid)
    RIGHT_EYE_P6 = 144  # Bottom-left (lower eyelid)

    # Left eye indices
    LEFT_EYE_P1 = 362   # Inner corner
    LEFT_EYE_P2 = 385   # Top-left (upper eyelid)
    LEFT_EYE_P3 = 387   # Top-right (upper eyelid)
    LEFT_EYE_P4 = 263   # Outer corner
    LEFT_EYE_P5 = 373   # Bottom-right (lower eyelid)
    LEFT_EYE_P6 = 380   # Bottom-left (lower eyelid)

    # Full contours for visual drawing
    LEFT_EYE_CONTOUR = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
    RIGHT_EYE_CONTOUR = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]

    MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    MODEL_PATH = "face_landmarker.task"

    def __init__(self, max_num_faces=1, min_detection_confidence=0.5, min_tracking_confidence=0.5):
        self._ensure_model_exists()
        
        # Configure FaceLandmarker
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=self.MODEL_PATH),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=max_num_faces,
            min_face_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence
        )
        self.landmarker = vision.FaceLandmarker.create_from_options(options)

    def _ensure_model_exists(self):
        """Checks if face landmarker model is downloaded, downloads it if missing."""
        if not os.path.exists(self.MODEL_PATH):
            print(f"Downloading MediaPipe Face Landmarker model from {self.MODEL_URL}...")
            try:
                # Use urllib to download to local path
                urllib.request.urlretrieve(self.MODEL_URL, self.MODEL_PATH)
                print("Model downloaded successfully!")
            except Exception as e:
                print(f"Error downloading model: {e}")
                # Fallback path logic can go here, but Google CDN is highly available.

    def calculate_distance(self, pt1, pt2):
        """Calculate Euclidean distance between two points."""
        return np.linalg.norm(np.array(pt1) - np.array(pt2))

    def calculate_ear(self, landmarks, eye_indices, width, height):
        """
        Calculate Eye Aspect Ratio (EAR) for a single eye.
        Formula: (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
        """
        coords = {}
        for idx in eye_indices:
            lm = landmarks[idx]
            coords[idx] = (int(lm.x * width), int(lm.y * height))

        # Vertical distances
        d_v1 = self.calculate_distance(coords[eye_indices[1]], coords[eye_indices[5]]) # p2 - p6
        d_v2 = self.calculate_distance(coords[eye_indices[2]], coords[eye_indices[4]]) # p3 - p5

        # Horizontal distance
        d_h = self.calculate_distance(coords[eye_indices[0]], coords[eye_indices[3]]) # p1 - p4

        if d_h == 0:
            return 0.0

        ear = (d_v1 + d_v2) / (2.0 * d_h)
        return ear

    def process_frame(self, frame):
        """
        Processes a single frame: detects face landmarks, draws overlays, and returns average EAR.
        Returns:
            processed_frame: RGB frame with visual overlays.
            ear: Average EAR of left and right eyes (or None if no face detected).
            face_detected: Boolean indicating if a face was detected.
        """
        h, w, c = frame.shape
        # FaceLandmarker expects RGB format
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        
        results = self.landmarker.detect(mp_image)

        avg_ear = None
        face_detected = False

        if results.face_landmarks:
            face_detected = True
            # Get the first face detected
            face_landmarks = results.face_landmarks[0]

            # Calculate EAR for both eyes
            right_indices = [
                self.RIGHT_EYE_P1, self.RIGHT_EYE_P2, self.RIGHT_EYE_P3,
                self.RIGHT_EYE_P4, self.RIGHT_EYE_P5, self.RIGHT_EYE_P6
            ]
            left_indices = [
                self.LEFT_EYE_P1, self.LEFT_EYE_P2, self.LEFT_EYE_P3,
                self.LEFT_EYE_P4, self.LEFT_EYE_P5, self.LEFT_EYE_P6
            ]

            right_ear = self.calculate_ear(face_landmarks, right_indices, w, h)
            left_ear = self.calculate_ear(face_landmarks, left_indices, w, h)
            avg_ear = (right_ear + left_ear) / 2.0

            # Draw visual contours on the frame (modifies frame in-place)
            self._draw_eye_contour(frame, face_landmarks, self.LEFT_EYE_CONTOUR, w, h, (0, 255, 255))
            self._draw_eye_contour(frame, face_landmarks, self.RIGHT_EYE_CONTOUR, w, h, (0, 255, 255))
            
            # Highlight key points used for EAR calculation
            for idx in right_indices + left_indices:
                lm = face_landmarks[idx]
                cv2.circle(frame, (int(lm.x * w), int(lm.y * h)), 2, (0, 0, 255), -1)

        # Convert back to RGB for Tkinter compatibility
        processed_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return processed_frame, avg_ear, face_detected

    def _draw_eye_contour(self, frame, landmarks, contour_indices, width, height, color):
        """Helper to draw a closed polygon around the eye contour."""
        pts = []
        for idx in contour_indices:
            lm = landmarks[idx]
            pts.append([int(lm.x * width), int(lm.y * height)])
        pts = np.array(pts, dtype=np.int32)
        cv2.polylines(frame, [pts], True, color, 1)

    def close(self):
        self.landmarker.close()
