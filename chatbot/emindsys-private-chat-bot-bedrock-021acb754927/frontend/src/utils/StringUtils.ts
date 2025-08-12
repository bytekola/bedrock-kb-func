export const toCamelCase = (str: string): string => {
  return str
    .split('-')
    .map((part, index) => {
      part = part.replace(/\./g, '');
      
      if (index === 0) {
        return part;
      } else {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
    })
    .join('');
}