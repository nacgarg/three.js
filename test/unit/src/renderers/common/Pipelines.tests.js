import Pipelines from '../../../../../src/renderers/common/Pipelines.js';

function createComputePipeline( pipelines, cacheKey, code ) {

	const computeProgram = { code, stage: 'compute', usedTimes: 1 };
	const pipeline = { isComputePipeline: true, cacheKey, computeProgram, usedTimes: 1 };

	pipelines.caches.set( cacheKey, pipeline );
	pipelines.programs.compute.set( code, computeProgram );

	return pipeline;

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'Common', () => {

		QUnit.module( 'Pipelines', () => {

			QUnit.test( 'releases the pipeline of a collected compute node', ( assert ) => {

				const info = { destroyProgram() {} };
				const pipelines = new Pipelines( {}, {}, info );

				// the pipeline data is what the finalization registry holds for a compute node:
				// it must be enough to release the pipeline without the node

				const data = { pipeline: createComputePipeline( pipelines, '1,1', 'code' ) };

				pipelines._releaseData( data );

				assert.strictEqual( pipelines.caches.size, 0, 'Compute pipeline removed from the cache.' );
				assert.strictEqual( pipelines.programs.compute.size, 0, 'Compute program released.' );
				assert.strictEqual( data.pipeline, undefined, 'Pipeline data cleared.' );

				pipelines._releaseData( data );

				assert.ok( true, 'Releasing twice is a no-op.' );

			} );

			QUnit.test( 'delete releases a compute pipeline still used elsewhere only once', ( assert ) => {

				const info = { destroyProgram() {} };
				const pipelines = new Pipelines( {}, {}, info );

				const pipeline = createComputePipeline( pipelines, '2,1', 'code' );
				pipeline.usedTimes = 2;
				pipeline.computeProgram.usedTimes = 2;

				const nodeA = {};
				const nodeB = {};

				pipelines.get( nodeA ).pipeline = pipeline;
				pipelines.get( nodeB ).pipeline = pipeline;

				pipelines.delete( nodeA );

				assert.strictEqual( pipelines.caches.size, 1, 'Pipeline kept while still in use.' );

				pipelines.delete( nodeB );

				assert.strictEqual( pipelines.caches.size, 0, 'Pipeline released with its last user.' );

			} );

		} );

	} );

} );
