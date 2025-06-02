import assert from 'node:assert';
import { promises as fs } from 'fs'; // 'fs/promises' not available in node 12
import { parse } from 'csv-parse/sync';

// Read the content
const content = await fs.readFile(`AirportCarpark.csv`);
// Parse the CSV content
const records: string[][] = parse(content);

// Extract the index of the columns we need
// WBS, Task, Predecessors, and Duration.
const column_headers = records[0].map((s: string) => s.trim().toLowerCase());

const wbs_index = column_headers.indexOf('wbs');
const task_index = column_headers.indexOf('task');
const pred_index = column_headers.indexOf('predecessors');
const duration_index = column_headers.indexOf('duration');

const error = (msg: string) => {
  throw new Error(msg);
};

if (wbs_index === -1) {
  error('wbs not found');
}
if (task_index === -1) {
  error('task not found');
}
if (pred_index === -1) {
  error('predecessors not found');
}
if (duration_index === -1) {
  error('duration not found');
}

const isAllCaps = (s: string) => {
  return s === s.toUpperCase();
};

// Loop over all the columns and create the "Tracks" resource.
// Look for each row that has an empty duration. All Caps indicates
// Track Major, Mixed Caps indicates Track Minor.

const rows = records.slice(1);

// First trim all strings.
rows.forEach((row: string[]) => {
  row.forEach((cell: string, index: number) => {
    row[index] = cell.trim();
  });
});

// Build up the values for the "Track" resource.
const tracks: string[] = [];
let trackMajor = '';
rows.forEach((row: string[]) => {
  if (row[duration_index] === '') {
    const task = row[task_index];
    if (isAllCaps(task)) {
      trackMajor = task;
      tracks.push(trackMajor);
      return;
    }
    tracks.push(`${trackMajor} - ${task}`);
  }
});

console.log(tracks);

// Create each task, only for rows with non-empty durations, setting name, duration, and ID (to WBS).
// Create map of WBS to task index.
// Loop through all tasks and set predecessors, using special algorithm for FF and SS tasks.
