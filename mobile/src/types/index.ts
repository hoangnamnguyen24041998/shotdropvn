import type { UsbCameraStatus } from '../lib/usbOtg';

export interface ActiveSession {
  id: string;
  event_name: string;
  qr_code_hash: string;
  created_at?: string;
}

export interface LocalPhotoItem {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
  base64?: string | null;
  cameraHandle?: number;
  cameraKey?: string;
  fileSize?: number;
}

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type { UsbCameraStatus };
