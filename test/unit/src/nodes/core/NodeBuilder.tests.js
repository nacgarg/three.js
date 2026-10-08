import NodeBuilder from '../../../../../src/nodes/core/NodeBuilder.js';

function createBuilder( renderContext ) {

	return { renderer: { _currentRenderContext: renderContext } };

}

function createSharedBindings( ids ) {

	const groupNode = { shared: true };

	return [ {
		groupNode,
		isNodeUniformsGroup: true,
		uniforms: ids.map( ( id ) => ( { nodeUniform: { node: { id } } } ) )
	} ];

}

export default QUnit.module( 'Nodes', () => {

	QUnit.module( 'Core', () => {

		QUnit.module( 'NodeBuilder', () => {

			QUnit.test( '_getBindGroup shares bind groups of shared uniform groups', ( assert ) => {

				const builder = createBuilder( {} );
				const getBindGroup = NodeBuilder.prototype._getBindGroup;

				const a = getBindGroup.call( builder, 'render', createSharedBindings( [ 2, 1 ] ) );
				const b = getBindGroup.call( builder, 'render', createSharedBindings( [ 1, 2 ] ) );

				assert.strictEqual( a, b, 'Same uniform nodes in the same render context share one bind group.' );

				const other = getBindGroup.call( createBuilder( {} ), 'render', createSharedBindings( [ 1, 2 ] ) );

				assert.notStrictEqual( a, other, 'Bind groups are not shared across render contexts.' );

			} );

			QUnit.test( '_getBindGroup cache keys separate uniform node ids', ( assert ) => {

				const builder = createBuilder( {} );
				const getBindGroup = NodeBuilder.prototype._getBindGroup;

				const a = getBindGroup.call( builder, 'render', createSharedBindings( [ 1, 2, 3 ] ) );
				const b = getBindGroup.call( builder, 'render', createSharedBindings( [ 1, 23 ] ) );

				assert.notStrictEqual( a, b, 'Different uniform nodes never share a bind group.' );

			} );

			QUnit.test( '_getBindGroup does not retain shared bind groups', async ( assert ) => {

				if ( typeof globalThis.gc !== 'function' ) {

					assert.expect( 0 );
					return; // needs --js-flags=--expose-gc

				}

				const builder = createBuilder( {} );
				let group = NodeBuilder.prototype._getBindGroup.call( builder, 'render', createSharedBindings( [ 7 ] ) );
				const ref = new WeakRef( group );
				group = null;

				await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
				globalThis.gc();

				assert.strictEqual( ref.deref(), undefined, 'An unused shared bind group is collected.' );

			} );

		} );

	} );

} );
