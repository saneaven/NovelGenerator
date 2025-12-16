/**
 * ObjectImagePickerModal - Modal for selecting an image for a reference object
 *
 * Shows images linked to the object first, then allows browsing all project assets
 */

import React, { useState, useEffect, useMemo } from 'react';
import { BaseModal } from '../BaseModal';
import { useProjectStore } from '../../store/projectStore';
import { assetService, type Asset, type StoryObjectAsset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import './ObjectImagePickerModal.css';

interface ObjectImagePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  objectId: string;
  objectType: string;
  onImageSelected: (assetId: string, thumbnailUrl: string) => void;
}

const ObjectImagePickerModal: React.FC<ObjectImagePickerModalProps> = ({
  isOpen,
  onClose,
  objectId,
  objectType,
  onImageSelected,
}) => {
  const { currentProjectId } = useProjectStore();
  const [activeTab, setActiveTab] = useState<'object' | 'all'>('object');
  const [objectAssets, setObjectAssets] = useState<StoryObjectAsset[]>([]);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load assets when modal opens
  useEffect(() => {
    if (!isOpen || !currentProjectId) return;

    const loadAssets = async () => {
      setLoading(true);
      setError(null);

      try {
        // Load object-linked assets
        const objectAssetsResponse = await assetService.getStoryObjectAssets(
          currentProjectId,
          objectType,
          objectId
        );
        setObjectAssets(objectAssetsResponse.assets);

        // Load all project assets
        const allProjectAssets = await assetService.listAssets(currentProjectId);
        setAllAssets(allProjectAssets);

        // If no object assets, switch to "all" tab
        if (objectAssetsResponse.assets.length === 0) {
          setActiveTab('all');
        }
      } catch (err) {
        setError('Failed to load assets');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, [isOpen, currentProjectId, objectId, objectType]);

  // Get display assets based on active tab
  const displayAssets = useMemo(() => {
    if (activeTab === 'object') {
      return objectAssets.map(oa => oa.asset);
    }
    return allAssets;
  }, [activeTab, objectAssets, allAssets]);

  // Handle asset selection
  const handleSelect = (asset: Asset) => {
    const thumbnailUrl = `${API_BASE_URL}${asset.thumbnail_url || asset.file_url}`;
    onImageSelected(asset.id, thumbnailUrl);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="medium"
      title="Select Reference Image"
      className="object-image-picker-modal"
      zIndexLayer={2}
    >
      <div className="picker-tabs">
        <button
          className={`picker-tab ${activeTab === 'object' ? 'active' : ''}`}
          onClick={() => setActiveTab('object')}
          disabled={objectAssets.length === 0}
        >
          Object Images ({objectAssets.length})
        </button>
        <button
          className={`picker-tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All Assets ({allAssets.length})
        </button>
      </div>

      <div className="picker-content">
        {loading ? (
          <div className="picker-loading">Loading assets...</div>
        ) : error ? (
          <div className="picker-error">{error}</div>
        ) : displayAssets.length === 0 ? (
          <div className="picker-empty">
            {activeTab === 'object'
              ? 'No images linked to this object'
              : 'No assets in project'}
          </div>
        ) : (
          <div className="asset-grid">
            {displayAssets.map(asset => (
              <button
                key={asset.id}
                className="asset-item"
                onClick={() => handleSelect(asset)}
                title={asset.name}
              >
                <img
                  src={`${API_BASE_URL}${asset.thumbnail_url || asset.file_url}`}
                  alt={asset.name}
                  loading="lazy"
                />
                <div className="asset-name">{asset.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default ObjectImagePickerModal;
