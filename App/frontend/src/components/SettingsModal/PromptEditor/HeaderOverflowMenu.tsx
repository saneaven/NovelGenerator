import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../IconButton';
import { MoreHorizontal } from '../../icons';
import { DropdownDivider, DropdownItem, DropdownMenu } from '../../ui/DropdownMenu';

export interface HeaderOverflowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  dividerAfter?: boolean;
}

interface HeaderOverflowMenuProps {
  items: HeaderOverflowMenuItem[];
  className?: string;
}

const HeaderOverflowMenu: React.FC<HeaderOverflowMenuProps> = ({
  items,
  className,
}) => {
  const { t } = useTranslation();
  const visibleItems = items.filter(Boolean);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <DropdownMenu
      trigger={
        <IconButton
          icon={<MoreHorizontal size="sm" />}
          title={t('common.showMore')}
          size="sm"
          variant="ghost"
          className={className}
        />
      }
      align="right"
    >
      {visibleItems.flatMap((item, index) => {
        const nodes: React.ReactNode[] = [
          <DropdownItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            onClick={item.onClick}
            variant={item.variant}
            disabled={item.disabled}
          />,
        ];

        if (item.dividerAfter && index < visibleItems.length - 1) {
          nodes.push(<DropdownDivider key={`${item.key}-divider`} />);
        }

        return nodes;
      })}
    </DropdownMenu>
  );
};

export default HeaderOverflowMenu;
