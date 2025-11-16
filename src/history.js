export class HistoryManager {
    constructor(maxSize = 20) {
        this.history = [];
        this.maxSize = maxSize;
        this.batching = false;
        this.batchBuffer = null;
    }

    /**
     * Pushes a new state snapshot to the history.
     * structuredClone is used for a deep copy.
     */
    push(snapshot) {
        // If we are not batching, just push the new state
        if (!this.batching) {
            // If the snapshot is the same as the last one, don't push it.
            if (this.history.length > 0 && JSON.stringify(snapshot) === JSON.stringify(this.history[this.history.length - 1])) {
                return;
            }
            this.history.push(structuredClone(snapshot));
            if (this.history.length > this.maxSize) {
                this.history.shift(); // Keep history size in check
            }
        } else {
            // If we are batching, only store the first state of the batch
            if (this.batchBuffer === null) {
                this.batchBuffer = structuredClone(snapshot);
            }
        }
    }

    /**
     * Pops the last state from the history and returns it.
     */
    pop() {
        return this.history.pop();
    }

    /**
     * Returns true if there is history to undo.
     */
    canUndo() {
        return this.history.length > 0;
    }

    /**
     * Starts a batch of operations. All operations until endBatch()
     * will be treated as a single undo step.
     */
    startBatch() {
        this.batching = true;
        this.batchBuffer = null; // Clear any previous buffer
    }

    /**
     * Ends a batch of operations. Pushes the initial state of the batch
     * to the history stack.
     */
    endBatch() {
        if (this.batchBuffer !== null) {
            this.history.push(this.batchBuffer);
            if (this.history.length > this.maxSize) {
                this.history.shift();
            }
        }
        this.batching = false;
        this.batchBuffer = null;
    }
}
