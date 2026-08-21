import React from 'react';
import type { NovelAICharacterPrompt } from '../../domain/imagePrompt';
import { ChevronDown, ChevronUp, Trash } from '../icons';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import {
  addNovelAICharacterPrompt,
  deleteNovelAICharacterPrompt,
  moveNovelAICharacterPrompt,
} from './novelAICharacterPromptList';
import './NovelAICharacterPromptCards.css';

interface NovelAICharacterPromptCardsProps {
  characters: NovelAICharacterPrompt[];
  onChange: (characters: NovelAICharacterPrompt[]) => void;
  disabled?: boolean;
}

const NovelAICharacterPromptCards: React.FC<NovelAICharacterPromptCardsProps> = ({
  characters,
  onChange,
  disabled = false,
}) => {
  const updateCharacter = (index: number, patch: Partial<NovelAICharacterPrompt>) => {
    onChange(characters.map((character, characterIndex) => (
      characterIndex === index ? { ...character, ...patch } : character
    )));
  };

  const moveCharacter = (index: number, offset: -1 | 1) => {
    onChange(moveNovelAICharacterPrompt(characters, index, offset));
  };

  return (
    <section className="novelai-character-prompts">
      <div className="novelai-character-prompts__heading">
        <div>
          <h4>Character Prompts</h4>
          <p>Optional per-character positive and undesired content prompts.</p>
        </div>
        <TextButton
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(addNovelAICharacterPrompt(characters))}
        >
          + Add Character
        </TextButton>
      </div>

      {characters.length === 0 ? (
        <div className="novelai-character-prompts__empty">No character prompts.</div>
      ) : (
        <div className="novelai-character-prompts__list">
          {characters.map((character, index) => (
            <article className="novelai-character-card" key={index}>
              <header className="novelai-character-card__header">
                <strong>Character {index + 1}</strong>
                <div className="novelai-character-card__actions">
                  <IconButton
                    icon={<ChevronUp size="sm" />}
                    size="xs"
                    variant="ghost"
                    title="Move character up"
                    disabled={disabled || index === 0}
                    onClick={() => moveCharacter(index, -1)}
                  />
                  <IconButton
                    icon={<ChevronDown size="sm" />}
                    size="xs"
                    variant="ghost"
                    title="Move character down"
                    disabled={disabled || index === characters.length - 1}
                    onClick={() => moveCharacter(index, 1)}
                  />
                  <IconButton
                    icon={<Trash size="sm" />}
                    size="xs"
                    variant="danger"
                    title={`Delete character ${index + 1}`}
                    disabled={disabled}
                    onClick={() => onChange(deleteNovelAICharacterPrompt(characters, index))}
                  />
                </div>
              </header>
              <div className="novelai-character-card__fields">
                <label>
                  <span>Positive</span>
                  <textarea
                    value={character.positive}
                    onChange={(event) => updateCharacter(index, { positive: event.target.value })}
                    placeholder="Character appearance, pose, clothing, expression..."
                    rows={3}
                    disabled={disabled}
                  />
                </label>
                <label>
                  <span>Negative</span>
                  <textarea
                    value={character.negative}
                    onChange={(event) => updateCharacter(index, { negative: event.target.value })}
                    placeholder="Undesired traits for this character..."
                    rows={3}
                    disabled={disabled}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default NovelAICharacterPromptCards;
