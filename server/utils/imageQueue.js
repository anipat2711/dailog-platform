// Concurrent job queue for Gemini API calls.
// Allows up to MAX_CONCURRENT simultaneous requests to maximize throughput
// while staying within Gemini rate limits.

const MAX_CONCURRENT = 3;
const DELAY_BETWEEN_DISPATCHES_MS = 100;

const queue = [];
let activeJobs = 0;

function addToQueue(job) {
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  while (activeJobs < MAX_CONCURRENT && queue.length > 0) {
    const { job, resolve, reject } = queue.shift();
    activeJobs++;

    job()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        activeJobs--;
        // Small delay before picking up next job
        if (queue.length > 0) {
          setTimeout(processQueue, DELAY_BETWEEN_DISPATCHES_MS);
        }
      });
  }
}

function getQueueLength() {
  return queue.length;
}

function getActiveJobs() {
  return activeJobs;
}

export { addToQueue, getQueueLength, getActiveJobs };
