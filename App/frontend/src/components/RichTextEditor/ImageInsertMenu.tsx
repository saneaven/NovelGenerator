/**
 * ImageInsertMenu - Dropdown menu for inserting images in RichTextEditor
 *
 * Features:
 * - Drag-and-drop area for uploading images
 * - File browser button
 * - AI image generation button
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import './ImageInsertMenu.css';

interface ImageInsertMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  onBrowseFiles: () => void;
  onGenerateImage: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function ImageInsertMenu({
  isOpen,
  onClose,
  onUpload,
  onBrowseFiles,
  onGenerateImage,
  anchorRef,
}: ImageInsertMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Calculate position relative to anchor element
  useEffect(() => {
    if (isOpen && anchorRef.current && menuRef.current) {
      const anchorRect = anchorRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();

      // Position below the button
      let top = anchorRect.bottom + 4;
      let left = anchorRect.left;

      // Adjust if menu would go off-screen
      if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 8;
      }
      if (top + menuRect.height > window.innerHeight) {
        top = anchorRect.top - menuRect.height - 4;
      }

      setPosition({ top, left });
    }
  }, [isOpen, anchorRef]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose, anchorRef]);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        onUpload(file);
        onClose();
      }
    }
  }, [onUpload, onClose]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  // Handle file input change
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onUpload(files[0]);
      onClose();
    }
    // Reset input
    e.target.value = '';
  }, [onUpload, onClose]);

  // Handle browse files button click
  const handleBrowseClick = useCallback(() => {
    onBrowseFiles();
    onClose();
  }, [onBrowseFiles, onClose]);

  // Handle generate image button click
  const handleGenerateClick = useCallback(() => {
    onGenerateImage();
    onClose();
  }, [onGenerateImage, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="image-insert-menu"
      style={{ top: position.top, left: position.left }}
    >
      {/* Drag-drop area */}
      <div
        className={`image-insert-dropzone ${isDragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="dropzone-icon">📁</div>
        <div className="dropzone-text">
          <span className="dropzone-primary">Drop image here</span>
          <span className="dropzone-secondary">or click to browse</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <div className="image-insert-divider" />

      {/* Action buttons */}
      <div className="image-insert-actions">
        <button
          type="button"
          className="image-insert-action-btn"
          onClick={handleBrowseClick}
        >
          <span className="action-icon">🖼️</span>
          <span className="action-label">From Assets</span>
        </button>
        <button
          type="button"
          className="image-insert-action-btn generate"
          onClick={handleGenerateClick}
        >
          <span className="action-icon">✨</span>
          <span className="action-label">Generate with AI</span>
        </button>
      </div>
    </div>
  );
}

export default ImageInsertMenu;
