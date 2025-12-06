/**
 * ReferenceImagePickerModal - Modal for selecting reference images for scene generation
 *
 * Shows images grouped by Story Object type (Character, Location, Organization, Lorebook)
 * with an upload option
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { assetService, type Asset, type StoryObjectAsset } from '../../api/assetService';
import { API_BASE_URL } from '../../api/client';
import './ReferenceImagePickerModal.css';

type StoryObjectTab = 'character' | 'location' | 'organization' | 'lorebook';

interface GroupedAssets {
  objectId: string;
  objectName: string;
  assets: Asset[];
}

interface ReferenceImagePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageSelected: (assetId: string, thumbnailUrl: string) => void;
  excludeAssetIds?: string[];
}

const TAB_CONFIG: { key: StoryObjectTab; label: string }[] = [
  { key: 'character', label: 'Characters' },
  { key: 'location', label: 'Locations' },
  { key: 'organization', label: 'Organizations' },
  { key: 'lorebook', label: 'Lorebook' },
];

const ReferenceImagePickerModal: React.FC<ReferenceImagePickerModalProps> = ({
  isOpen,
  onClose,
  onImageSelected,
  excludeAssetIds = [],
}) => {
  const { currentProjectId } = useProjectStore();
  const { listObjects } = useUnifiedObjectStore();
  const { settings } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<StoryObjectTab>('character');
  const [groupedAssets, setGroupedAssets] = useState<Map<StoryObjectTab, GroupedAssets[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load all object images when modal opens
  useEffect(() => {
    if (!isOpen || !currentProjectId) return;

    const loadAllAssets = async () => {
      setLoading(true);
      setError(null);

      try {
        const newGroupedAssets = new Map<StoryObjectTab, GroupedAssets[]>();

        for (const tab of TAB_CONFIG) {
          // Load objects of this type
          const objects = await listObjects(tab.key, currentProjectId);

          const groups: GroupedAssets[] = [];

          for (const obj of objects) {
            // Get object name from data
            const mainLanguage = settings?.main_language || 'English';
            const langData = obj.data[mainLanguage] || Object.values(obj.data)[0];
            const objectName = langData?.name || 'Unnamed';

            // Load assets for this object
            try {
              const response = await assetService.getStoryObjectAssets(
                currentProjectId,
                tab.key,
                obj.id
              );

              if (response.assets.length > 0) {
                groups.push({
                  objectId: obj.id,
                  objectName,
                  assets: response.assets.map(soa => soa.asset),
                });
              }
            } catch {
              // Skip objects with no assets
            }
          }

          newGroupedAssets.set(tab.key, groups);
        }

        setGroupedAssets(newGroupedAssets);
      } catch (err) {
        setError('Failed to load assets');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadAllAssets();
  }, [isOpen, currentProjectId, listObjects, settings?.main_language]);

  // Get display groups based on active tab and search
  const displayGroups = useMemo(() => {
    const groups = groupedAssets.get(activeTab) || [];

    if (!searchQuery.trim()) {
      return groups;
    }

    const query = searchQuery.toLowerCase();
    return groups
      .map(group => ({
        ...group,
        assets: group.assets.filter(
          asset =>
            asset.name.toLowerCase().includes(query) ||
            group.objectName.toLowerCase().includes(query)
        ),
      }))
      .filter(group => group.assets.length > 0);
  }, [activeTab, groupedAssets, searchQuery]);

  // Count assets per tab
  const tabCounts = useMemo(() => {
    const counts: Record<StoryObjectTab, number> = {
      character: 0,
      location: 0,
      organization: 0,
      lorebook: 0,
    };

    for (const [tab, groups] of groupedAssets) {
      counts[tab] = groups.reduce((sum, g) => sum + g.assets.length, 0);
    }

    return counts;
  }, [groupedAssets]);

  // Handle asset selection
  const handleSelect = useCallback((asset: Asset) => {
    if (excludeAssetIds.includes(asset.id)) return;
    const thumbnailUrl = `${API_BASE_URL}${asset.thumbnail_url || asset.file_url}`;
    onImageSelected(asset.id, thumbnailUrl);
  }, [excludeAssetIds, onImageSelected]);

  // Handle file upload
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentProjectId) return;

    setUploading(true);
    try {
      const asset = await assetService.uploadAsset(currentProjectId, file, undefined, 'scene');
      const thumbnailUrl = `${API_BASE_URL}${asset.thumbnail_url || asset.file_url}`;
      onImageSelected(asset.id, thumbnailUrl);
    } catch (err) {
      setError('Failed to upload image');
      console.error(err);
    } finally {
      setUploading(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="reference-image-picker-overlay" onClick={onClose}>
      <div className="reference-image-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h3>Select Reference Image</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        {/* Search and Upload */}
        <div className="picker-toolbar">
          <input
            type="text"
            className="search-input"
            placeholder="Search images..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button
            className="upload-btn"
            onClick={handleUploadClick}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : '+ Upload Image'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Tabs */}
        <div className="picker-tabs">
          {TAB_CONFIG.map(tab => (
            <button
              key={tab.key}
              className={`picker-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              disabled={tabCounts[tab.key] === 0}
            >
              {tab.label} ({tabCounts[tab.key]})
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="picker-content">
          {loading ? (
            <div className="picker-loading">Loading assets...</div>
          ) : error ? (
            <div className="picker-error">{error}</div>
          ) : displayGroups.length === 0 ? (
            <div className="picker-empty">
              No images found for {TAB_CONFIG.find(t => t.key === activeTab)?.label}
            </div>
          ) : (
            <div className="grouped-assets">
              {displayGroups.map(group => (
                <div key={group.objectId} className="asset-group">
                  <div className="group-header">{group.objectName}</div>
                  <div className="asset-grid">
                    {group.assets.map(asset => {
                      const isExcluded = excludeAssetIds.includes(asset.id);
                      return (
                        <button
                          key={asset.id}
                          className={`asset-item ${isExcluded ? 'excluded' : ''}`}
                          onClick={() => handleSelect(asset)}
                          disabled={isExcluded}
                          title={isExcluded ? 'Already selected' : asset.name}
                        >
                          <img
                            src={`${API_BASE_URL}${asset.thumbnail_url || asset.file_url}`}
                            alt={asset.name}
                            loading="lazy"
                          />
                          {isExcluded && <div className="excluded-overlay">Selected</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReferenceImagePickerModal;
