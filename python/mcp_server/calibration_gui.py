import tkinter as tk
from tkinter import messagebox

class CalibrationGUI:
    def __init__(self, send_command_callback, offset_x, offset_y):
        self.send_command = send_command_callback
        self.offset_x = offset_x
        self.offset_y = offset_y
        
        self.root = tk.Tk()
        self.root.title("IK Calibration")
        
        frame = tk.Frame(self.root, padx=20, pady=20)
        frame.pack()

        # Calib 0 Section
        tk.Label(frame, text="Calib 0 (cm)", font=('Arial', 12, 'bold')).grid(row=0, column=0, columnspan=2, pady=(0, 10))
        
        tk.Label(frame, text="X:").grid(row=1, column=0, sticky="e")
        self.c0_x = tk.Entry(frame, width=10)
        self.c0_x.grid(row=1, column=1)
        
        tk.Label(frame, text="Y:").grid(row=2, column=0, sticky="e")
        self.c0_y = tk.Entry(frame, width=10)
        self.c0_y.grid(row=2, column=1)
        
        tk.Label(frame, text="Z:").grid(row=3, column=0, sticky="e")
        self.c0_z = tk.Entry(frame, width=10)
        self.c0_z.grid(row=3, column=1)

        tk.Button(frame, text="Send Calib 0", command=self.send_calib0).grid(row=4, column=0, columnspan=2, pady=10)

        # Separator
        tk.Frame(frame, height=2, bd=1, relief=tk.SUNKEN).grid(row=5, column=0, columnspan=2, sticky="ew", pady=10)

        # Calib 1 Section
        tk.Label(frame, text="Calib 1 (cm)", font=('Arial', 12, 'bold')).grid(row=6, column=0, columnspan=2, pady=(0, 10))
        
        tk.Label(frame, text="X:").grid(row=7, column=0, sticky="e")
        self.c1_x = tk.Entry(frame, width=10)
        self.c1_x.grid(row=7, column=1)
        
        tk.Label(frame, text="Y:").grid(row=8, column=0, sticky="e")
        self.c1_y = tk.Entry(frame, width=10)
        self.c1_y.grid(row=8, column=1)
        
        tk.Label(frame, text="Z:").grid(row=9, column=0, sticky="e")
        self.c1_z = tk.Entry(frame, width=10)
        self.c1_z.grid(row=9, column=1)

        tk.Button(frame, text="Send Calib 1", command=self.send_calib1).grid(row=10, column=0, columnspan=2, pady=10)

        # Separator
        tk.Frame(frame, height=2, bd=1, relief=tk.SUNKEN).grid(row=11, column=0, columnspan=2, sticky="ew", pady=10)

        # Save Button
        tk.Button(frame, text="Save Calibration", command=self.send_save, bg="#dddddd").grid(row=12, column=0, columnspan=2, pady=10)

    def _get_coords_mm(self, entry_x, entry_y, entry_z):
        try:
            x_mm = float(entry_x.get()) * 10.0
            y_mm = float(entry_y.get()) * 10.0
            z_mm = float(entry_z.get()) * 10.0
            
            # Apply offsets (mm) to get world coordinates (x, y, z)
            x_w_mm = x_mm + self.offset_x
            y_w_mm = y_mm + self.offset_y
            z_w_mm = z_mm # Assuming no Z offset
            
            # Already in mm for the robot controller
            return x_w_mm, y_w_mm, z_w_mm
        except ValueError:
            messagebox.showerror("Error", "Invalid numeric input")
            return None

    def _send_calib(self, cmd_name, entry_x, entry_y, entry_z):
        coords = self._get_coords_mm(entry_x, entry_y, entry_z)
        if coords:
            x, y, z = coords
            cmd = f"{cmd_name} x={x:.2f} y={y:.2f} z={z:.2f}"
            print(f"Sending: {cmd}")
            resp = self.send_command(cmd)
            messagebox.showinfo("Response", f"Sent: {cmd}\nResponse: {resp}")

    def send_calib0(self):
        self._send_calib("calib0", self.c0_x, self.c0_y, self.c0_z)

    def send_calib1(self):
        self._send_calib("calib1", self.c1_x, self.c1_y, self.c1_z)

    def send_save(self):
        cmd = "save"
        print(f"Sending: {cmd}")
        resp = self.send_command(cmd)
        messagebox.showinfo("Response", f"Sent: {cmd}\nResponse: {resp}")

    def run(self):
        self.root.mainloop()