import Geometries from '../../../../../src/renderers/common/Geometries.js';
import { BufferGeometry } from '../../../../../src/core/BufferGeometry.js';
import { BufferAttribute } from '../../../../../src/core/BufferAttribute.js';

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'Common', () => {

		QUnit.module( 'Geometries', () => {

			QUnit.test( 'geometry dispose does not use the render object that initialized it', ( assert ) => {

				const deleted = [];

				const attributes = {
					delete( attribute ) {

						deleted.push( attribute );

					}
				};

				const info = { memory: { geometries: 0 } };

				const geometries = new Geometries( attributes, info );

				const geometry = new BufferGeometry();
				const position = new BufferAttribute( new Float32Array( 9 ), 3 );
				geometry.setAttribute( 'position', position );

				const nodeAttribute = new BufferAttribute( new Float32Array( 3 ), 1 );

				const renderObject = {
					geometry,
					getAttributes() {

						return [ position, nodeAttribute ];

					}
				};

				geometries.initGeometry( renderObject );

				// the render object may be disposed and collected long before the geometry

				renderObject.geometry = null;
				renderObject.getAttributes = () => {

					throw new Error( 'render object accessed on geometry dispose' );

				};

				geometry.dispose();

				assert.ok( deleted.includes( position ), 'Geometry attribute released.' );
				assert.ok( deleted.includes( nodeAttribute ), 'Node attribute released.' );
				assert.strictEqual( info.memory.geometries, 0, 'Geometry count updated.' );
				assert.strictEqual( geometries._geometryRefs.size, 0, 'Geometry no longer tracked.' );

			} );

			QUnit.test( 'initialized geometries are tracked weakly', ( assert ) => {

				const info = { memory: { geometries: 0 } };
				const geometries = new Geometries( { delete() {} }, info );

				const geometry = new BufferGeometry();
				geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( 9 ), 3 ) );

				geometries.initGeometry( { geometry, getAttributes: () => Object.values( geometry.attributes ) } );

				assert.strictEqual( info.memory.geometries, 1, 'Geometry counted.' );
				assert.strictEqual( geometries._geometryRefs.size, 1, 'Geometry tracked.' );
				assert.ok( [ ...geometries._geometryRefs ][ 0 ] instanceof WeakRef, 'Geometry referenced weakly.' );

				geometries.dispose();

				assert.strictEqual( geometry.hasEventListener( 'dispose', geometries.get( geometry ).onDispose ), false, 'Dispose listener removed on renderer dispose.' );
				assert.strictEqual( geometries._geometryRefs.size, 0, 'No geometries tracked after dispose.' );

			} );

		} );

	} );

} );
