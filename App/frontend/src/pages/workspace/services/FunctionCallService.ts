export class FunctionCallService {
  static mapFunctionToEditType(functionName: string): any {
    switch (functionName) {
      case 'initialize_story_objects': return 'init';
      case 'add_story_objects': return 'add';
      case 'edit_story_objects': return 'edit';
      case 'remove_story_objects': return 'remove';
      default: return 'edit';
    }
  }

  static getFunctionCallTitle(functionName: string): string {
    switch (functionName) {
      case 'initialize_story_objects': return '🔄 Initialize Story';
      case 'add_story_objects': return '➕ Add Items';
      case 'edit_story_objects': return '✏️ Edit Items';
      case 'remove_story_objects': return '🗑️ Remove Items';
      default: return '📝 Function Call';
    }
  }

  static getFunctionCallDescription(functionName: string): string {
    switch (functionName) {
      case 'initialize_story_objects': return 'Initialize all story objects for the project';
      case 'add_story_objects': return 'Add new story objects to the project';
      case 'edit_story_objects': return 'Modify existing story objects';
      case 'remove_story_objects': return 'Remove story objects from the project';
      default: return 'Execute function call';
    }
  }

  static getFunctionDisplayName(functionName: string): string {
    switch (functionName) {
      case 'initialize_story_objects': return 'Story initialization';
      case 'add_story_objects': return 'Story objects addition';
      case 'edit_story_objects': return 'Story objects modification';
      case 'remove_story_objects': return 'Story objects removal';
      default: return `Function "${functionName}"`;
    }
  }

  static generateFunctionCallSummary(functionName: string, args: any): string {
    if (!args) return this.getFunctionCallDescription(functionName);
    
    const parts: string[] = [];
    
    switch (functionName) {
      case 'initialize_story_objects':
        if (args.basic_info) parts.push('basic info');
        if (args.characters?.length) parts.push(`${args.characters.length} character${args.characters.length > 1 ? 's' : ''}`);
        if (args.organizations?.length) parts.push(`${args.organizations.length} organization${args.organizations.length > 1 ? 's' : ''}`);
        if (args.locations?.length) parts.push(`${args.locations.length} location${args.locations.length > 1 ? 's' : ''}`);
        if (args.lorebook?.length) parts.push(`${args.lorebook.length} lorebook entr${args.lorebook.length > 1 ? 'ies' : 'y'}`);
        if (args.acts?.length) parts.push(`${args.acts.length} act${args.acts.length > 1 ? 's' : ''}`);
        break;
        
      case 'add_story_objects':
        if (args.characters?.length) parts.push(`${args.characters.length} character${args.characters.length > 1 ? 's' : ''}`);
        if (args.organizations?.length) parts.push(`${args.organizations.length} organization${args.organizations.length > 1 ? 's' : ''}`);
        if (args.locations?.length) parts.push(`${args.locations.length} location${args.locations.length > 1 ? 's' : ''}`);
        if (args.lorebook?.length) parts.push(`${args.lorebook.length} lorebook entr${args.lorebook.length > 1 ? 'ies' : 'y'}`);
        if (args.acts?.length) parts.push(`${args.acts.length} act${args.acts.length > 1 ? 's' : ''}`);
        if (args.chapters?.length) parts.push(`${args.chapters.length} chapter${args.chapters.length > 1 ? 's' : ''}`);
        break;
        
      case 'edit_story_objects':
        if (args.basic_info) parts.push('basic info');
        if (args.objects?.length) parts.push(`${args.objects.length} object${args.objects.length > 1 ? 's' : ''}`);
        break;
        
      case 'remove_story_objects':
        if (args.objects?.length) parts.push(`${args.objects.length} object${args.objects.length > 1 ? 's' : ''}`);
        break;
    }
    
    return parts.length > 0 
      ? `${this.getFunctionCallDescription(functionName)}: ${parts.join(', ')}`
      : this.getFunctionCallDescription(functionName);
  }
}