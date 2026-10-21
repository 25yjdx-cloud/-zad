export function getSuggestedAzkarTrack(date = new Date()) {
  const hour = date.getHours();
  return hour >= 4 && hour < 16 ? 'morning' : 'evening';
}
