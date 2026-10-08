import RenderPipeline from '../../../../../src/renderers/common/RenderPipeline.js';
import { NoToneMapping, SRGBColorSpace } from '../../../../../src/constants.js';
import { vec4 } from '../../../../../src/nodes/tsl/TSLBase.js';

function createRenderer() {

	return {
		toneMapping: NoToneMapping,
		outputColorSpace: SRGBColorSpace,
		xr: { enabled: false },
		render() {}
	};

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'Common', () => {

		QUnit.module( 'RenderPipeline', () => {

			QUnit.test( 'dispose releases the output node graph', ( assert ) => {

				const outputNode = vec4( 1, 0, 0, 1 );
				const pipeline = new RenderPipeline( createRenderer(), outputNode );

				pipeline.render();

				const material = pipeline._quadMesh.material;

				assert.notStrictEqual( material.fragmentNode, null, 'Output graph set up by render().' );

				pipeline.dispose();

				assert.strictEqual( material.fragmentNode, null, 'Fragment node released.' );
				assert.strictEqual( material.contextNode, null, 'Context node released.' );

				pipeline.render();

				assert.notStrictEqual( material.fragmentNode, null, 'Output graph set up again by the next render().' );

			} );

		} );

	} );

} );
