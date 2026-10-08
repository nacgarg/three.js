import WebGPUBackend from '../../../../../src/renderers/webgpu/WebGPUBackend.js';
import { submit, deferSubmit, submitDeferred, isDeferredBuffer } from '../../../../../src/renderers/webgpu/utils/WebGPUUtils.js';

// a device whose queue records the submitted command buffers

function createDevice( log ) {

	return {
		queue: {
			submit( commands ) {

				log.push( commands.slice() );

			}
		}
	};

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'WebGPU', () => {

		QUnit.module( 'WebGPUBackend', () => {

			QUnit.test( 'deferred command buffers are submitted in order', ( assert ) => {

				const log = [];
				const device = createDevice( log );
				const bufferA = {}, bufferB = {};

				submit( device, 'a' );
				assert.deepEqual( log, [[ 'a' ]], 'Without deferred commands a command is submitted alone.' );

				deferSubmit( device, 'b', [ bufferA ] );
				deferSubmit( device, 'c', [ bufferA, bufferB ] );

				assert.strictEqual( log.length, 1, 'Deferred commands are not submitted yet.' );
				assert.ok( isDeferredBuffer( device, bufferA ) && isDeferredBuffer( device, bufferB ), 'The buffers they read are tracked.' );
				assert.notOk( isDeferredBuffer( device, {} ), 'Other buffers are not.' );

				submit( device, 'd' );

				assert.deepEqual( log, [[ 'a' ], [ 'b', 'c', 'd' ]], 'The next command is submitted after the deferred ones, in one call.' );
				assert.notOk( isDeferredBuffer( device, bufferA ), 'Nothing is tracked after the submit.' );

				deferSubmit( device, 'e', [] );
				submitDeferred( device );
				submitDeferred( device );

				assert.deepEqual( log[ 2 ], [ 'e' ], 'submitDeferred() submits the deferred commands.' );
				assert.strictEqual( log.length, 3, 'And does nothing when there are none.' );

			} );

			QUnit.test( 'writes and destroys submit the deferred commands first', ( assert ) => {

				const log = [];
				const device = createDevice( log );

				const backend = new WebGPUBackend();
				backend.device = device;

				const pendingBuffer = { destroy: () => log.push( 'destroy' ) };
				const otherBuffer = {};

				backend.bindingUtils = { updateBinding: () => log.push( 'write' ) };
				backend.attributeUtils = { updateAttribute: () => log.push( 'attribute' ), destroyAttribute: () => log.push( 'destroy attribute' ) };
				backend.textureUtils = { updateTexture: () => log.push( 'texture' ), destroyTexture: () => log.push( 'destroy texture' ) };

				const pendingBinding = {}, otherBinding = {};
				backend.get( pendingBinding ).buffer = pendingBuffer;
				backend.get( otherBinding ).buffer = otherBuffer;

				const run = ( action ) => {

					log.length = 0;
					deferSubmit( device, 'pass', [ pendingBuffer ] );
					action();
					const result = log.map( ( entry ) => Array.isArray( entry ) ? entry.join() : entry );
					submitDeferred( device );
					return result;

				};

				assert.deepEqual( run( () => backend.updateBinding( otherBinding ) ), [ 'write' ], 'A buffer no deferred command reads is written right away.' );
				assert.deepEqual( run( () => backend.updateBinding( pendingBinding ) ), [ 'pass', 'write' ], 'A buffer a deferred command reads is written after its submit.' );
				assert.deepEqual( run( () => backend.updateAttribute( {} ) ), [ 'pass', 'attribute' ], 'Attribute updates.' );
				assert.deepEqual( run( () => backend.destroyAttribute( {} ) ), [ 'pass', 'destroy attribute' ], 'Attribute destroys.' );
				assert.deepEqual( run( () => backend.updateTexture( {} ) ), [ 'pass', 'texture' ], 'Texture updates.' );
				assert.deepEqual( run( () => backend.destroyTexture( {} ) ), [ 'pass', 'destroy texture' ], 'Texture destroys.' );
				assert.deepEqual( run( () => backend.destroyUniformBuffer( pendingBinding ) ), [ 'pass', 'destroy' ], 'Uniform buffer destroys.' );

			} );

		} );

	} );

} );
